---
description: Show this machine's usable model-memory budget and installed Ollama models
argument-hint: ""
---

Follow the `local-model-fit` skill and its boundaries.

Run `llm-checker hw-detect --json`. Report `summary.effectiveMemory`, the
dedicated or unified-memory context, CPU, and selected backend exactly as
detected; do not look for a `largestModel` field.

Then run `llm-checker ollama`. Only when Ollama is available, run
`llm-checker installed --json` and report the installed models using
`fileSizeGB`, quantization, score, and use case. Its stdout is valid JSON; keep
any stderr progress text separate.

This command does not inventory every possible runtime. Do not use `toolcheck`
for discovery because it loads a model and runs inference.
