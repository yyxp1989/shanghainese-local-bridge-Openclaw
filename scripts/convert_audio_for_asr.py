#!/usr/bin/env python3
"""Convert Telegram-style voice/audio files to 16k mono WAV for local ASR.

Uses the static ffmpeg binary shipped by imageio-ffmpeg, so no system ffmpeg is required.

Usage:
  python3 convert_audio_for_asr.py input.ogg output.wav
"""
from __future__ import annotations
import os
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print('Usage: convert_audio_for_asr.py <input> <output.wav>', file=sys.stderr)
        return 2
    src = os.path.abspath(sys.argv[1])
    dst = os.path.abspath(sys.argv[2])
    if not os.path.exists(src):
        print(f'ERROR: input not found: {src}', file=sys.stderr)
        return 3
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        print(f'ERROR: cannot load imageio_ffmpeg: {e}', file=sys.stderr)
        return 4

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    cmd = [
        ffmpeg,
        '-y',
        '-i', src,
        '-ac', '1',
        '-ar', '16000',
        '-f', 'wav',
        dst,
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode('utf-8', errors='ignore')[-2000:]
        print(f'ERROR: ffmpeg conversion failed\n{err}', file=sys.stderr)
        return 5

    print(dst)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
