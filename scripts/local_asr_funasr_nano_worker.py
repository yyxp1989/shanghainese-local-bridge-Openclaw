#!/usr/bin/env python3
"""Persistent Fun-ASR-Nano worker.

Loads Fun-ASR-Nano-2512 once and serves local HTTP transcription requests.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PLUGIN_DIR / 'vendor' / 'Fun-ASR'
CONVERT_SCRIPT = PLUGIN_DIR / 'scripts' / 'convert_audio_for_asr.py'
MODEL_ID = 'FunAudioLLM/Fun-ASR-Nano-2512'
HOST = '127.0.0.1'
PORT = 8765

MODEL = None
MODEL_KWARGS = None
LOAD_SECONDS = None


def maybe_convert_audio(audio: str) -> str:
    ext = os.path.splitext(audio)[1].lower()
    if ext in {'.wav', '.flac'}:
        return audio
    fd, out = tempfile.mkstemp(prefix='funasr-nano-worker-', suffix='.wav')
    os.close(fd)
    try:
        subprocess.run([sys.executable, str(CONVERT_SCRIPT), audio, out], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return out
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode('utf-8', errors='ignore')
        raise RuntimeError(f'audio conversion failed: {err}')


def load_model() -> None:
    global MODEL, MODEL_KWARGS, LOAD_SECONDS
    if MODEL is not None:
        return
    start = time.perf_counter()
    from model import FunASRNano  # imported from repo via PYTHONPATH
    MODEL, MODEL_KWARGS = FunASRNano.from_pretrained(model=MODEL_ID, device='cpu')
    MODEL.eval()
    LOAD_SECONDS = time.perf_counter() - start


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self._json(200, {
                'ok': True,
                'model': MODEL_ID,
                'loaded': MODEL is not None,
                'load_seconds': round(LOAD_SECONDS or 0.0, 3),
            })
            return
        self._json(404, {'ok': False, 'error': 'not_found'})

    def do_POST(self):
        if self.path != '/transcribe':
            self._json(404, {'ok': False, 'error': 'not_found'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            payload = json.loads(self.rfile.read(length) or b'{}')
            audio = os.path.abspath(str(payload.get('audio') or '').strip())
            if not audio or not os.path.exists(audio):
                self._json(400, {'ok': False, 'error': 'audio_not_found'})
                return
            prepared = maybe_convert_audio(audio)
            start = time.perf_counter()
            res = MODEL.inference(data_in=[prepared], **MODEL_KWARGS)
            elapsed = time.perf_counter() - start
            text = ''
            try:
                text = res[0][0]['text'] if res and res[0] else ''
            except Exception:
                text = ''
            self._json(200, {
                'ok': True,
                'audio': audio,
                'prepared_audio': prepared,
                'text': text,
                'infer_seconds': round(elapsed, 3),
                'model': MODEL_ID,
            })
        except Exception as e:
            self._json(500, {'ok': False, 'error': str(e)})

    def log_message(self, format, *args):
        return


def main() -> int:
    if not REPO_DIR.exists():
        print(f'ERROR: repo not found: {REPO_DIR}', file=sys.stderr)
        return 2
    load_model()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'READY {HOST}:{PORT}', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
