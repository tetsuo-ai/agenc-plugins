---
description: Show this machine's hardware budget and its installed Ollama models
argument-hint: ""
---

Follow the `local-model-fit` skill and its boundaries.

Run `llm-checker hw-detect --json` and report the GPU or unified memory budget,
the CPU, and the selected backend. On Apple Silicon report the unified memory
pool rather than looking for a dedicated VRAM figure.

Then run `llm-checker ollama` for integration status and `llm-checker installed`
for the models already present, ranked against this hardware. Read the human
output — `installed --json` prints progress to stdout and does not parse.

The CLI does not discover installed runtimes. If the user wants that, check with
`command -v ollama llama-cli lms` and report only what you found. Do not use
`toolcheck` for this: it loads models and runs inference.
