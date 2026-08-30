---
name: local-model-fit
description: Recommend or assess local LLM artifacts against this machine's measured usable-memory budget with llm-checker. Use when the user asks which model to run locally, whether a named model or quantization will fit, or what the machine can handle.
allowed-tools: [Bash, Read]
---

# Local model fit

Base answers on the installed `llm-checker` release and measured hardware. Do
not infer model footprints from memory or parameter count alone when the
registry exposes an exact artifact.

## Preflight

```bash
command -v llm-checker
llm-checker --version
llm-checker registry-recommend --help
```

If the binary is absent, stop and tell the user to install it with
`npm install -g llm-checker`. Do not install it automatically or substitute
`npx`. This skill targets `llm-checker` 3.8.1; if the installed help lacks a
documented command or flag, report the version mismatch instead of guessing.

## Measure the budget

Run this before answering what fits:

```bash
llm-checker hw-detect --json
```

Retain `summary.effectiveMemory`, `summary.bestBackend`,
`summary.runtimeBackend`, `summary.totalVRAM`, `summary.hasIntegratedGPU`,
`summary.hasDedicatedGPU`, and `summary.systemRAM`. They distinguish dedicated
VRAM, unified memory, and CPU fallback. Do not look for a serialized "largest
model" field; the JSON does not contain one.

Use the values returned by the detector instead of applying a separate memory
percentage. On Apple Silicon, `effectiveMemory` already represents the usable
unified-memory budget.

## Recommend an exact artifact

Use the registry command because it has clean JSON and reports the artifact's
estimated memory requirement:

```bash
llm-checker registry-recommend --category general --runtime auto --target-context 8192 --limit 5 --json
llm-checker registry-recommend --category coding --runtime auto --target-context 8192 --limit 5 --json
```

Valid categories are `general`, `coding`, `reasoning`, `embeddings`, and
`multimodal`. If the user's task does not map cleanly to one, use `general` and
say so. Valid runtime targets are `auto`, `ollama`, `llama.cpp`, `vllm`, `mlx`,
and `transformers`.

`--runtime auto` chooses a preferred runtime from artifact metadata; it does
not prove that runtime is installed, serving, or supported by this operating
system. Treat its result as hardware/artifact fit until runtime availability is
checked separately.

Use the user's requested context when provided. Otherwise keep the explicit
8192-token assumption shown above and state it in the answer.

Read these fields from each recommendation:

- `model`, `artifact`, `source`, and `quantization`
- `required_gb`: estimated memory needed, including the selector's assumptions
- `size_gb`: artifact or file size metadata when the registry knows it
- `runtime`, `install_command`, and `download_url`
- `score`, `rationale`, and `memory.memorySource`

Before finalizing any pick, cross-check its exact artifact and quantization:

```bash
llm-checker registry-search "RETURNED MODEL" --source <source> --quant <quantization> --limit 20 --json
```

Accept the fit verdict only when `model` matches that row's
`canonical_model_id` or `repo_id`, `artifact` matches its `artifact_name` or
`filename`, and source plus quantization also match. Require one unique row;
generic filenames such as `model.safetensors` are not identities. Before
presenting a command or URL, also require it to equal `install_command` or
`download_url` from that same row. Apply this check to category recommendations
as well as named-model queries; if the top pick fails it, inspect the next
candidate rather than silently changing identity or quantization.

`--target-context` affects scoring but is not a hard capability filter. Require
the matched search row's `context_length` to be at least the requested target
before saying the artifact meets that context. If the field is absent, context
support is unknown; if it is lower, the model may fit memory but does not meet
the requested context.

Derive the selector budget from the top-level `hardware` returned by the same
command: use `effectiveMemory` for Metal or integrated-only hardware; otherwise
use a positive `totalVRAM`, falling back to `effectiveMemory`. Cross-check those
fields against the preceding `hw-detect`, and report the remaining headroom.
All returned recommendations already fit this selector budget, so do not infer
a numeric deficit from an empty result. `required_gb` is an estimate, not a
measurement. Say whether `memory.memorySource` is
`observed_artifact_size`, `estimated_from_params`, or `moe_total_params`;
observed artifact size still leaves context and runtime overhead estimated.
Describe the score as deterministic fit and suitability, never as a public
benchmark result.

Do not accept a fit verdict for FP16/BF16 (including `F16`, `FP32`, or `F32`) or
a sharded safetensors/bin artifact when `memory.memorySource` is not
`observed_artifact_size`. Version 3.8.1 can underestimate those weights from
parameter count. Without an observed total size, report exact fit as unknown.

If `recommendations` is empty, inspect the counters. `total_artifacts: 0` means
no eligible artifact matched the active query and filters; gated artifacts are
excluded by default. A positive `total_artifacts` with no recommendations means
no matching artifact produced a fitting, rankable candidate under the requested
constraints. Do not run `registry-sync` or silently fall back to an unrelated
model.

## Assess a named model

Pass the user's model name as one safely quoted query argument and inspect the
registry matches before scoring them:

```bash
llm-checker registry-search "MODEL QUERY" --runtime auto --limit 20 --json
llm-checker registry-recommend "MODEL QUERY" --category general --runtime auto --target-context 8192 --limit 20 --json
```

The search is substring-based. Use its `source_id`, `canonical_model_id`,
`artifact_name`, `parameter_count_b`, `format`, and `quantization` to verify the
identity. Add `--source`, `--format`, or `--quant` to both commands when needed
to isolate the requested artifact. Only treat a recommendation as the requested
model when its `source`, `artifact`, and `quantization` identify the same row
from `registry-search`.

The 3.8.1 selector can hypothesize a more compressed quantization than the
indexed artifact while retaining that artifact's install command. If the
recommendation's `quantization` differs from the uniquely matched search row,
do not use its fit verdict or install command for that artifact. Search for a
row with the recommended quantization and re-run with `--quant`; if none exists,
label the result hypothetical and the exact fit unknown.

A family name alone is not an exact model. If it matches multiple sizes or
quantizations, enumerate them and ask for the intended variant or report each
variant separately. Never let a fitting small variant answer for a larger
member of the same family.

A returned recommendation proves that variant fits the selector budget. An
empty recommendation list is conclusive only when the exact artifact was
isolated and `total_candidates` is positive; otherwise report the result as
unknown. Never turn a substring match or an empty ambiguous result into a
yes/no answer, and do not approximate with `check --min-size` or `--max-size`.

Do not present `size_gb` as the model's complete footprint unless
`memory.memorySource` is `observed_artifact_size`; for sharded artifacts it may
describe only one file. Use `required_gb` for the fit decision.

`registry-recommend --max-size <gb>` filters artifact size in GB.
`--min-params <billion>` and `--max-params <billion>` filter parameter count.
Keep those units distinct.

## Verify the selected runtime

Before saying an artifact is runnable *now*, verify the runtime returned by the
recommendation. Use only the relevant probes:

```bash
command -v ollama
command -v llama-cli
command -v llama-server
command -v vllm
```

If `python3` is available, locate Python runtimes without importing them:

```bash
python3 -c 'import importlib.util as u; print({m: bool(u.find_spec(m)) for m in ("vllm", "mlx_lm", "transformers")})'
```

For Ollama, use `llm-checker ollama` to distinguish an installed client from a
reachable server. For MLX, also require Apple Silicon/Metal. Report a missing
runtime separately from model fit; do not convert it into a claim that the
artifact itself does not fit. LM Studio's `lms` command is not a valid
`--runtime` value for this CLI.

## Installed Ollama models

Check integration first:

```bash
llm-checker ollama
```

If Ollama is available, inspect the installed models with parseable JSON:

```bash
llm-checker installed --json
```

Use `fileSizeGB`, `quantization`, `score`, and `useCase` from that output. An
empty array together with a non-zero exit status means Ollama is unavailable;
an empty array after a successful integration check means no models are
installed. Do not describe `installed --json` as malformed or mix stderr
progress text into stdout JSON.

For a named model that appears in this installed list, make the fit assessment
against its exact Ollama tag:

```bash
llm-checker ollama-plan --models "EXACT INSTALLED TAG" --ctx 8192 --concurrency 1 --json
llm-checker verify-context --model "EXACT INSTALLED TAG" --target 8192 --json
```

Use the user's requested context or concurrency when provided. Compare
`plan.memory.requestedEstimatedGB` with `plan.memory.budgetGB` to decide whether
the requested settings fit. First confirm that `selection.selected` contains
the exact requested tag because selection also accepts prefix and family
matches. If the request does not fit, report whether the reduced profile fits
from `plan.recommendation.fits`; if that is false, report `plan.fallback.fits`
and its `estimated_memory_gb`. Do not claim the original request fits merely
because a reduced profile does, and do not execute the environment-variable
recommendations from `plan.shell`.

Use `verify-context` to check the model's declared and memory-limited context;
confirm its output `model` is the exact requested tag. `ollama-plan --ctx` alone
does not prove that the model declares support for that context.

When the user did not provide workload settings, state that the assessment
assumes an 8192-token context and concurrency 1.

## Reporting

Lead with the artifact and fit result. A useful answer contains:

- exact model/artifact and quantization
- `required_gb` of the selector budget, plus remaining headroom
- selected runtime, its separately verified availability, and the rationale
- the install command or download URL exactly as returned

Only present the command after model/repository, source, artifact,
quantization, and command/URL match one unique registry-search row, the context
requirement passes, and the memory-source guard does not make fit unknown. Do
not invent a command when `install_command` is empty, and never attribute the
suitability score to HumanEval, MMLU, LiveBench, or another leaderboard.

## Boundaries

- Do not execute an `install_command`, download, or pull a model.
- Do not start or stop a runtime server.
- Do not run `sync`, `registry-sync`, `calibrate`, or another catalog-writing
  command unless the user explicitly asks.
- Do not use `toolcheck` for discovery; it loads an Ollama model and runs
  inference.

These commands do not change the user's models or runtime configuration, but
`llm-checker` may maintain its own database and cache under `~/.llm-checker`.
