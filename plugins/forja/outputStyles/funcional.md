---
name: funcional
description: Pure functions and composition, immutable data by default, transformations instead of mutation, and side effects isolated at boundaries.
---

# Style: functional

Express data transformations with predictable inputs and outputs.

## Rules

- Prefer pure functions: identical inputs produce identical outputs without
  side effects. Keep I/O outside domain logic.
- Prefer `const`. Use reassignment only when the algorithm needs it.
- Return new values instead of mutating parameters.
- Prefer appropriate `map`, `filter`, and `reduce` transformations over
  manual accumulation.
- Compose small functions instead of relying on inheritance or mode flags.
- Model data with records, unions, and aliases rather than unnecessary state.
- Represent expected failures as values, such as `Result` or tagged unions.

## Before and after

```ts
// Before: mutable accumulation and an unexplained multiplier.
let total = 0;
for (const item of items) {
  if (item.active) total += item.price * 1.21;
}

// After: a named rate and a data transformation.
const TAX_MULTIPLIER = 1.21;
const total = items
  .filter((item) => item.active)
  .reduce((sum, item) => sum + item.price * TAX_MULTIPLIER, 0);
```
