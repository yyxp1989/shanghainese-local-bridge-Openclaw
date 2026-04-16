#!/usr/bin/env python3
"""Rule-based Shanghainese -> more natural Mandarin phrase/order rewrite.

This layer is intentionally conservative and only handles a few stable, high-frequency
patterns that are suitable for deterministic post-processing.
"""

from __future__ import annotations

import re
import sys


def rewrite(text: str) -> str:
    out = text.strip()
    if not out:
        return out

    rules = [
        # 要星期天天好 -> 星期天天好 / 天气要好
        (r'^要(星期[一二三四五六日天].*好)$', r'\1'),
        # 明天要下雨 / 明天要落雨 keep shape, just normalize if still present
        (r'落雨', '下雨'),
        # 早朗向/早朗/早浪/早向 already largely handled by mappings, keep redundancy here
        (r'早朗向|早朗|早浪|早向', '早上'),
        # 夜里 / 日里 mild normalization
        (r'日里', '白天'),
        # 饭点相关整理
        (r'今天夜里向夜饭吃过了吗', '你今天晚上吃过晚饭了吗'),
        (r'今天向夜饭吃过了吗', '你今天吃过晚饭了吗'),
        (r'今天中饭吃过了吗', '你今天吃过午饭了吗'),
        (r'今天早饭吃过了吗', '你今天吃过早饭了吗'),
        (r'听得到我了说什么', '听得到我在说什么吗'),
        (r'听得到我说什么', '听得到我在说什么吗'),
        (r'今天夜里向夜饭', '今天晚上晚饭'),
        (r'今天向夜饭', '今天晚饭'),
        (r'今天中饭', '今天午饭'),
        (r'今天早饭', '今天早饭'),
        (r'吃过了伐', '吃过了吗'),
        (r'吃好了伐', '吃好了吗'),
        (r'夜里向夜饭', '晚上晚饭'),
        (r'向夜饭', '晚饭'),
        # 一屁股坐很长时间 style safety cleanup
        (r'一屁股坐很长时间', '坐了很长时间'),
        # 要 + 时间/天气 + 好  -> 时间/天气 + 好
        (r'^要(.+好)$', r'\1'),
    ]

    for pattern, repl in rules:
        out = re.sub(pattern, repl, out)

    out = re.sub(r'^(你)\1+', r'\1', out)
    out = re.sub(r'听得到我在说什么吗吗$', '听得到我在说什么吗', out)
    out = re.sub(r'\s+', ' ', out).strip()
    return out


def main() -> int:
    if len(sys.argv) > 1:
        text = ' '.join(sys.argv[1:])
    else:
        text = sys.stdin.read()
    text = text.strip()
    if not text:
        print('', end='')
        return 0
    print(rewrite(text))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
