---
description: Recommend a local model artifact that fits this machine's measured memory budget
argument-hint: "[category or model name]"
---

Follow the `local-model-fit` skill and its boundaries.

Measure the machine with `llm-checker hw-detect --json`. Then run
`llm-checker registry-recommend --category <category> --runtime auto --target-context 8192 --limit 5 --json`.
Use a user-supplied context when present; otherwise disclose the 8192-token
assumption. If the argument names a model rather than a category, first use
`registry-search` to identify an exact artifact, then pass the same safely
quoted query and any disambiguating source, format, or quantization filters to
`registry-recommend`. A family-only match is not exact: keep sizes and
quantizations separate instead of choosing whichever variant fits. Accept the
fit verdict and install command only when canonical model/repository, source,
artifact, quantization, and command/URL match one unique search row; a
selector-hypothesized quantization is not that artifact. Perform the same
registry-search cross-check for a category pick.
Also require the row's `context_length` to meet the target, and treat
high-precision or sharded artifacts without observed total size as unknown.

Report the selected artifact's `required_gb` against the selector budget
described by the skill, including remaining headroom, quantization, runtime,
rationale, `memory.memorySource`, and the exact returned install command or
download URL. If no recommendation is returned, distinguish no registry match
(`total_artifacts: 0` means no eligible match under the active filters), an
isolated non-fitting candidate, and an ambiguous unknown result; do not invent
a numeric deficit.

Call the memory requirement an estimate and the score a deterministic fit and
suitability score, not a benchmark. If the requested model is already installed
in Ollama, use `ollama-plan` as described by the skill. Treat `--runtime auto`
as a hardware-fit target until the returned runtime is verified separately.
Never execute an install command or generated environment settings.
