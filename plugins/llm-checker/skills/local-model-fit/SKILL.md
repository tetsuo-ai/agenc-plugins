---
name: local-model-fit
description: Work out which local LLM this machine can actually run, using the llm-checker CLI to read real hardware and a VRAM budget. Use when the user asks which model to run locally, whether a model will fit, or what their machine can handle.
allowed-tools: [Bash, Read]
---

# Local model fit

Answer "which model can I actually run here" from measured hardware, not from
memory. Model footprints and quantization sizes change constantly, and a wrong
answer costs a multi-gigabyte download.

## Preflight

```bash
command -v llm-checker
```

If the binary is absent, stop and tell the user to install it
(`npm install -g llm-checker`). Do not install it automatically, do not
substitute `npx`, and do not answer from memory instead.

Check what you are working with before relying on any flag:

```bash
llm-checker --version
llm-checker <command> --help
```

This skill targets the published CLI. If a flag below is missing on the
installed version, say so rather than guessing an alternative.

## Always start from the hardware

Never assume the machine. This is the only command here with clean,
parseable JSON:

```bash
llm-checker hw-detect --json
```

Returns `backends`, `primary`, `cpu`, `systemGpu`, `summary`, `fingerprint`.
Read the budget from `summary` — it carries the tier and the largest model size
the machine is judged able to hold.

### Reading the memory budget correctly

- **Discrete GPU (NVIDIA / AMD):** dedicated VRAM is the budget. System RAM is
  not a substitute — a model that spills out of VRAM runs an order of magnitude
  slower.
- **Apple Silicon:** there is no separate VRAM. CPU and GPU share one unified
  memory pool, and roughly 60-75% of total RAM is addressable by the GPU
  depending on the machine. Report the unified figure; do not look for a
  dedicated VRAM number and do not report "no GPU" because none is listed.
- **No discrete GPU on a PC:** say plainly that inference will run on CPU at a
  few tokens per second, rather than recommending a model as if it were fast.

## Ranked recommendations

```bash
llm-checker recommend
llm-checker recommend -c coding
```

`-c` / `--category` takes a category such as `coding`, `talking` or `reading`.

There is **no `--json` on `recommend`** — the output is a human-readable report.
Read it and summarise; do not pipe it into a JSON parser.

Useful flags that do exist: `--runtime <ollama|vllm|mlx>`, `--optimize
<profile>`, `--max-size`, and `--simulate` with `--gpu` / `--ram` / `--vram` to
model a machine other than this one.

### Be honest about what the ranking is

The published CLI ranks with a deterministic scorer built on parameter count,
quantization footprint, hardware fit, context and popularity. It is a **fit and
suitability ranking, not a benchmark leaderboard.** Present it that way.

Do not claim a model is "the best at coding" or attribute a score to
HumanEval, MMLU, LiveBench or any public benchmark. The CLI does not publish
per-model benchmark provenance, so any such number would be invented.

## Check what fits

```bash
llm-checker check
llm-checker check --max-size 14B
llm-checker check --runtime ollama
```

Reports the system summary and compatible models against the detected hardware.
There is no `--json` here either, and no flag to check one named model — so when
the user asks about a specific model, use `--max-size` / `--min-size` to bracket
it and read the report, rather than inventing a per-model command.

## Installed Ollama models

```bash
llm-checker ollama
llm-checker installed
```

`ollama` reports integration status; `installed` ranks the models already
present. `installed --json` exists but its progress output goes to stdout and
corrupts the JSON, so read the human output instead of parsing it.

## Runtimes

The CLI's `--runtime` flag accepts `ollama`, `vllm` and `mlx`. It does **not**
discover which runtimes are installed on the machine, and `toolcheck` is not a
discovery command — it is a tool-calling compatibility tester that loads
installed Ollama models and runs inference against them.

If the user wants to know what is installed, check directly:

```bash
command -v ollama llama-cli lms
```

and report only what you actually found.

## Reporting

Lead with the answer, then the reason. Name the model, its quantization, what it
needs against what the machine has, and the command to get it:

> `qwen2.5-coder:7b` — about 6 GB of your 12 GB, Q6_K.
> Ranked top for coding on this hardware by fit and suitability.
> `ollama pull qwen2.5-coder:7b-base-q6_K`

State memory as *needed of available*, never as a bare number. Flag the case
where a model fits but leaves no headroom for a long context window, because
the user will hit it.

## Boundaries

- Do not download or pull a model. Hand over the command.
- Do not start or stop a runtime server.
- Do not run `sync`, `calibrate`, or anything that rewrites the catalog unless
  the user explicitly asks.
- Avoid `toolcheck` unless the user specifically wants tool-calling tested: it
  loads models and runs inference, which is slow and uses real memory.

These commands are non-destructive but not side-effect free — `llm-checker`
maintains a catalog and cache under `~/.llm-checker/`. Say "it does not change
your models or runtimes" rather than "it writes nothing".
