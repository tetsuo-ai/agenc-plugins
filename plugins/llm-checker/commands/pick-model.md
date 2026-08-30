---
description: Recommend a local model that fits this machine's VRAM
argument-hint: "[use case, e.g. coding]"
---

Follow the `local-model-fit` skill and its read-only boundary.

Start with `llm-checker hw-detect` so the VRAM budget is a measured fact rather
than an assumption, then `llm-checker recommend --json`, narrowing with
`--use-case` when a use case was given.

Report the pick as *used of available* VRAM, state whether its quality score was
measured against a public benchmark or estimated from parameter count, and hand
over the install command for a runtime the user actually has. Never download a
model or start a server.
