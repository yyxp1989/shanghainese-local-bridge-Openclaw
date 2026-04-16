#!/usr/bin/env python3
"""Light cleanup for noisy spoken-ASR transcripts before LLM normalization.

This script is intentionally conservative. It removes common Mandarin filler words,
collapses repeated punctuation/spaces, and outputs a cleaned transcript that is still
close to the original wording.

Usage:
  python3 clean_transcript.py "嗯那个我想说就是今朝阿拉先去看看"
  cat input.txt | python3 clean_transcript.py
"""
import re
import sys

FILLERS = [
    "嗯", "呃", "额", "啊", "哦", "唉", "诶", "欸", "那个", "这个", "就是说", "就是", "然后", "你知道吧",
]

PUNCT_REPEATS = re.compile(r"([，。！？；,.!?;])\1+")
SPACE_RE = re.compile(r"\s+")
REPEAT_CHAR_RE = re.compile(r"(.)(\1{2,})")


def clean(text: str) -> str:
    out = text.strip()
    for f in sorted(FILLERS, key=len, reverse=True):
        out = out.replace(f, " ")
    out = REPEAT_CHAR_RE.sub(r"\1", out)
    out = PUNCT_REPEATS.sub(r"\1", out)
    out = SPACE_RE.sub(" ", out)
    out = re.sub(r"\s*([，。！？；,.!?;])\s*", r"\1", out)
    out = re.sub(r"([。！？；!?])(?=[^\n])", r"\1\n", out)
    out = re.sub(r"\n{2,}", "\n", out)
    out = re.sub(r"^[，。！？；,.!?;\s]+|[，。！？；,.!?;\s]+$", "", out)
    return out.strip()


def main() -> int:
    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
    else:
        text = sys.stdin.read()
    text = text.strip()
    if not text:
        print("", end="")
        return 0
    print(clean(text))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
