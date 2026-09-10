---
name: defensivo
description: Fail early with clear errors, validate external inputs at boundaries, make defaults explicit, and never silently swallow exceptions.
---

# Style: defensive

Assume external data may be invalid. Validate at the boundary, then work
with the validated representation.

## Rules

- Validate API parameters, payloads, files, and network responses before use.
- Fail early with actionable errors instead of defaults that hide problems.
- Handle exceptions with context or rethrow them with useful information.
- Give switches an explicit default that fails or documents the case.
- Assert important invariants, including cases assumed to be impossible.
- Centralize parsing and validation at boundaries instead of scattering it.

## Before and after

```ts
// Before: assumes valid structure and guesses a missing value.
function parseConfig(raw: unknown) {
  const value = JSON.parse(raw as string);
  return { retries: value.retries ?? 3 };
}

// After: validates the boundary explicitly.
function parseConfig(raw: unknown): Config {
  if (typeof raw !== "string") {
    throw new ConfigError(`expected JSON string, got ${typeof raw}`);
  }
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.retries !== "number") {
    throw new ConfigError("config.retries must be a number");
  }
  return { retries: value.retries };
}
```
