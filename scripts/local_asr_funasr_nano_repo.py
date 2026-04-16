#!/usr/bin/env python3
"""Run Fun-ASR-Nano through the official repo path.

Prefers a persistent local worker when available, and auto-starts it on demand.
Falls back to direct repo execution only if worker startup/request fails.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PLUGIN_DIR / 'vendor' / 'Fun-ASR'
CONVERT_SCRIPT = PLUGIN_DIR / 'scripts' / 'convert_audio_for_asr.py'
FFMPEG_BIN_DIR = Path.home() / '.openclaw' / 'venvs' / 'funasr' / 'bin'
WORKER_SCRIPT = PLUGIN_DIR / 'scripts' / 'local_asr_funasr_nano_worker.py'
WORKER_URL = 'http://127.0.0.1:8765'
WORKER_LOG = PLUGIN_DIR / 'data' / 'funasr-nano-worker.log'


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument('audio')
    p.add_argument('--device', default='cpu')
    p.add_argument('--json', action='store_true')
    return p


def maybe_convert_audio(audio: str) -> str:
    ext = os.path.splitext(audio)[1].lower()
    if ext in {'.wav', '.flac'}:
        return audio
    fd, out = tempfile.mkstemp(prefix='funasr-nano-', suffix='.wav')
    os.close(fd)
    try:
        subprocess.run([sys.executable, str(CONVERT_SCRIPT), audio, out], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return out
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode('utf-8', errors='ignore')
        raise RuntimeError(f'audio conversion failed: {err}')


def worker_health() -> bool:
    try:
        with urllib.request.urlopen(f'{WORKER_URL}/health', timeout=2) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
            return bool(payload.get('ok'))
    except Exception:
        return False


def ensure_worker() -> bool:
    if worker_health():
        return True
    env = os.environ.copy()
    env['PYTHONPATH'] = str(REPO_DIR)
    env['PATH'] = f"{FFMPEG_BIN_DIR}:{env.get('PATH','')}"
    WORKER_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(WORKER_LOG, 'ab') as logf:
        subprocess.Popen(
            [sys.executable, str(WORKER_SCRIPT)],
            cwd=str(REPO_DIR),
            env=env,
            stdout=logf,
            stderr=logf,
            start_new_session=True,
        )
    deadline = time.time() + 60
    while time.time() < deadline:
        if worker_health():
            return True
        time.sleep(1)
    return False


def request_worker(audio: str) -> dict:
    req = urllib.request.Request(
        f'{WORKER_URL}/transcribe',
        data=json.dumps({'audio': audio}).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode('utf-8'))


def direct_repo_transcribe(audio: str, device: str) -> dict:
    try:
        prepared_audio = maybe_convert_audio(audio)
    except Exception as e:
        raise RuntimeError(str(e))
    runner = f"""
from model import FunASRNano
m, kwargs = FunASRNano.from_pretrained(model='FunAudioLLM/Fun-ASR-Nano-2512', device={device!r})
m.eval()
res = m.inference(data_in=[{prepared_audio!r}], **kwargs)
print(res[0][0]['text'])
"""
    env = os.environ.copy()
    env['PYTHONPATH'] = str(REPO_DIR)
    env['PATH'] = f"{FFMPEG_BIN_DIR}:{env.get('PATH','')}"
    proc = subprocess.run(
        [sys.executable, '-c', runner],
        cwd=str(REPO_DIR),
        env=env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    lines = [line.strip() for line in (proc.stdout or '').splitlines() if line.strip()]
    return {
        'audio': audio,
        'prepared_audio': prepared_audio,
        'backend': 'fun-asr-nano-repo',
        'device': device,
        'text': lines[-1] if lines else '',
        'mode': 'direct-repo',
    }


def main() -> int:
    args = build_parser().parse_args()
    audio = os.path.abspath(args.audio)
    if not os.path.exists(audio):
        print(f'ERROR: audio file not found: {audio}', file=sys.stderr)
        return 2
    if not REPO_DIR.exists():
        print(f'ERROR: Fun-ASR repo not found: {REPO_DIR}', file=sys.stderr)
        return 2

    try:
        if ensure_worker():
            payload = request_worker(audio)
            payload['backend'] = 'fun-asr-nano-repo'
            payload['mode'] = 'persistent-worker'
        else:
            payload = direct_repo_transcribe(audio, args.device)
    except Exception as e:
        print(f'ERROR: model invocation failed: {e}', file=sys.stderr)
        return 3

    text = str(payload.get('text') or '').strip()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(text)
    return 0 if text else 4


if __name__ == '__main__':
    raise SystemExit(main())
