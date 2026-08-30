---
name: local-model-fit
description: Pick a local LLM that actually fits this machine, and see which local runtimes are installed. Uses the llm-checker CLI to read real hardware, VRAM budget and benchmark-backed rankings. Use whenever the user asks which model to run locally, whether a model will fit, or what their machine can handle.
allowed-tools: [Bash, Read]
---

# Local model fit

Answer "which model can I actually run here" from measured facts, not from
memory. Model sizes, VRAM budgets and quantization footprints change constantly,
and a wrong answer wastes a multi-gigabyte download.

## Preflight

```bash
command -v llm-checker
```

If the binary is absent, stop and tell the user to install it
(`npm install -g llm-checker`). Do not install it automatically, do not fall
back to `npx`, and do not answer the question from memory instead.

Every command below is read-only. None of them download a model, start a
server, or change the user's runtime configuration.

## Always start from the hardware

Never assume the machine. Run this first for any question about what fits:

```bash
llm-checker hw-detect
```

This reports the GPU and its dedicated VRAM, the CPU and its instruction set,
system memory, the selected backend (CUDA / ROCm / Metal), and a "largest model"
figure. The VRAM number is the budget every later answer is measured against —
system RAM is not a substitute, because a model that spills out of VRAM runs
an order of magnitude slower.

On a machine with no discrete GPU, say so plainly rather than recommending a
model that will only run on CPU at a few tokens per second.

## Ranked recommendations

```bash
llm-checker recommend --json
```

Returns ranked picks per use case: general, coding, reasoning, multimodal,
creative, chat and long-context. Each entry carries the model name, parameter
count, quantization, estimated VRAM (`estimatedRAM`, in GB), estimated speed,
and the exact install command.

Add `--runtime <name>` to target one runtime, and `--use-case <category>` when
the user named a task. For a "just tell me one model" request, take the
`general` pick and say why it won.

### Read the provenance before you present a score

Each recommendation carries a `qualitySource`:

- `{ kind: 'measured', metric, rawScore, source }` — a real public benchmark
  (BigCodeBench, EvalPlus, LiveBench, MMMU) matched to this model.
- `{ kind: 'estimated', basis: 'parameter count' }` — no benchmark exists for
  it, so quality was inferred from size alone.

Most of the catalog is estimated. When you present a ranking, say which kind of
number it is. Never describe an estimate as a measurement or call a model "the
best at coding" when nothing measured it.

If `sizeUnknown` is set on a measured entry, the benchmark scored the model
*family* rather than that exact build — say so.

## Check one specific model

When the user names a model, answer whether it fits rather than offering a list:

```bash
llm-checker check --json
```

Compare the model's `estimatedRAM` against the VRAM from `hw-detect`:

- comfortably under budget — it fits, with room for context
- above roughly 80% of VRAM — it fits but leaves no headroom for a long
  context window; say that, because the user will hit it
- over budget — it will not run on the GPU; give the next size down or a
  smaller quantization instead of implying it might work

## Which runtimes are present

```bash
llm-checker toolcheck
```

The tool supports several local runtimes and they are not interchangeable:

| Runtime | Format | Note |
|---|---|---|
| Ollama | its own registry, GGUF | easiest; one command per model |
| llama.cpp | GGUF | most control; models come from Hugging Face, not a registry |
| LM Studio | GGUF, MLX | GUI plus an OpenAI-compatible server |
| vLLM | safetensors | needs a discrete accelerator; not available on macOS |
| MLX | MLX, safetensors | Apple Silicon only |
| Transformers | safetensors | widest coverage, slowest to start; needs torch |

Give the install command for a runtime the user actually has. A GGUF pick under
llama.cpp needs a Hugging Face download, not `ollama pull` — offering the wrong
verb sends them down a dead end.

## Reporting

Lead with the answer, then the reason. A useful reply names the model, its
quantization, what it needs against what the machine has, and the one command
to get it:

> `qwen2.5-coder:7b` — 6.1 GB of your 12 GB, Q6_K.
> Measured 40.4 pass@1 on BigCodeBench.
> `ollama pull qwen2.5-coder:7b-base-q6_K`

State the VRAM figure as *used of available*, never as a bare number. If a
recommendation rests on an estimate rather than a benchmark, say so in the same
breath rather than in a footnote.

## Boundaries

- Read-only. Never run `sync`, `calibrate` or any command that writes to the
  catalog unless the user explicitly asks for it.
- Never pull or download a model on the user's behalf. Hand them the command.
- Never start or stop a runtime server.
- If `hw-detect` fails or reports no GPU, report that honestly instead of
  falling back to a generic recommendation.
