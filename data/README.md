# Shanghainese adaptation data

This directory stores append-only user-confirmed speech adaptation data.

## Files
- `confirmed-transcripts.jsonl`: confirmed audio/text pairs
- `correction-lexicon.json`: accumulated ASR error -> correction hints
- `finetune-manifest.jsonl`: reviewed export for later finetuning

## Rules
- append-only by default
- keep raw audio path when available
- store only confirmed final text in finetune manifest
- never store secrets here
