---
description: Show which local LLM runtimes are installed and usable
argument-hint: ""
---

Follow the `local-model-fit` skill and its read-only boundary.

Run `llm-checker toolcheck` and report, per runtime, whether it is installed,
whether a server is currently serving, and its version. Note which model formats
each one can load, since GGUF and safetensors are not interchangeable.

Where a runtime is missing, give its install command but do not install it.
Never start or stop a server.
