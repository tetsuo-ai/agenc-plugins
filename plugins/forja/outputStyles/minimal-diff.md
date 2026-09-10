---
name: minimal-diff
description: The smallest coherent change to existing code, matching the file's indentation, quotes, naming, and patterns without unrelated cleanup.
---

# Style: minimal-diff

Treat the existing file's conventions as the specification.

## Rules

- Match its indentation, quote style, naming, and structure.
- Make the smallest change that solves the complete request. Every changed
  line must have a task-related reason.
- Avoid rename cascades and syntax migrations unless explicitly requested.
- Follow the file's abstraction level and patterns when adding code.
- Match its import style and add dependencies only when necessary.
- Review the diff as a clear sequence: problem, change, verification.
  Simplify it if unrelated work obscures that sequence.

## Before and after

For a request to support a configurable timeout, do not migrate the module
system, add TypeScript, or reformat the file.

```diff
 const client = require('./client')
-module.exports = function fetch(url) {
-  return client.get(url)
+module.exports = function fetch(url, timeoutMs) {
+  return client.get(url, { timeout: timeoutMs })
 }
```

Run the project's tests to verify the requested behavior and existing cases.
