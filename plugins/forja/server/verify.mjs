/**
 * Deterministic code verifier for Forge. Heuristic
 * structural analysis over JS/TS and Python source, no AST, no
 * dependencies: function length and count via brace/def indentation
 * tracking, nesting depth, parameter counts, magic numbers, duplicate
 * normalized blocks, naming convention consistency, debug leftovers,
 * dead imports, else-after-return, empty catch, long lines/files, plus
 * per-style bands and (for minimal-diff) consistency against the
 * ORIGINAL file being edited: indentation style/width, quote style and
 * naming convention must match the host file, measurably.
 * Heuristics are stated as heuristics; the model writes, this judges.
 */

export const CODE_STYLE_RULESETS = {
  clean: { family: "tone", rules: ["fnBand:25:40", "namesRevealIntent", "noMagicNumbers", "noDebugLeftovers", "earlyReturns"] },
  defensive: { family: "tone", rules: ["noEmptyCatch", "noSwallowedDefaults", "switchHasDefault"] },
  functional: { family: "tone", rules: ["constOverLet", "noParamMutation", "pureTransforms"] },
  solid: { family: "tone", rules: ["classSizeBands", "injectedDeps", "noGodSwitch"] },
  "minimal-diff": { family: "form", rules: ["matchOriginal"] },
};

// Accepted input IDs and filenames retain compatibility with earlier releases.
export const CODE_STYLE_ALIASES = Object.freeze({
  limpio: "clean", defensivo: "defensive", funcional: "functional",
});
export const CODE_STYLE_FILES = Object.freeze({
  clean: "limpio", defensive: "defensivo", functional: "funcional",
  solid: "solid", "minimal-diff": "minimal-diff",
});

const BASE_RULES = [
  "fnBand:40:60",
  "nestingDepth",
  "paramCount",
  "longLines",
  "longFile",
  "duplicateBlocks",
  "namingConsistency",
  "noDebugLeftovers",
  "noEmptyCatch",
  "deadImports",
  "elseAfterReturn",
  "todoLeft",
];

const DEBUG_ERROR = /\bconsole\.(?:log|debug|info)\s*\(|\bdebugger\b|(?<![\w.])print\s*\(|\bpdb\.set_trace\s*\(|\bSystem\.out\.print/gu;

const FN_STARTERS = {
  js: [
    /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/gu,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gu,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/gu,
    /(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/gu,
  ],
  py: [
    /^\s*def\s+([A-Za-z_]\w*)\s*\(/gmu,
    /^\s*async\s+def\s+([A-Za-z_]\w*)\s*\(/gmu,
    /^\s*class\s+([A-Za-z_]\w*)/gmu,
  ],
};

/**
 * Lint one source file. `language` is "js" (JS/TS) or "py". For
 * minimal-diff, pass `original` (the file's current contents) so the
 * consistency checks run against it.
 */
export function verifyCode(code, { style = "clean", language = "js", original } = {}) {
  style = Object.hasOwn(CODE_STYLE_ALIASES, style) ? CODE_STYLE_ALIASES[style] : style;
  const ruleset = Object.hasOwn(CODE_STYLE_RULESETS, style) ? CODE_STYLE_RULESETS[style] : undefined;
  if (ruleset === undefined) {
    return { error: `unknown style '${style}'; known: ${Object.keys(CODE_STYLE_RULESETS).join(", ")}` };
  }
  const lang = language === "py" || language === "python" ? "py" : "js";
  if (typeof code !== "string" || !code.trim()) return { error: "code must be a non-empty string" };
  if (code.length > 100000 || (typeof original === "string" && original.length > 100000)) return { error: "source exceeds 100000 characters; lint one module at a time" };
  if (!["js", "ts", "javascript", "typescript", "py", "python"].includes(language)) return { error: "language must be js/ts or py" };
  if (style === "minimal-diff" && typeof original !== "string") return { error: "minimal-diff requires original source for comparison" };
  const source = code;
  const structural = lang === "js" ? maskJsLiterals(source) : source;
  const violations = [];
  const violation = (severity, rule, excerpt, fix) =>
    violations.push({ severity, rule, excerpt: String(excerpt).slice(0, 120), fix });
  const active = new Set([...BASE_RULES, ...ruleset.rules]);
  // Style bands override the base band: style rules win.
  const band = [...ruleset.rules, ...BASE_RULES].find((rule) => rule.startsWith("fnBand:"));

  const stats = analyze(source, lang);

  // ── Function length band ─────────────────────────────────────────
  if (band !== undefined) {
    const [, warnLines, errorLines] = band.split(":").map(Number);
    for (const fn of stats.functions) {
      if (fn.lines > errorLines) {
        violation("error", "fn-too-long", `${fn.name}() is ${fn.lines} lines`, `Split into smaller functions (style ceiling ${errorLines}, warn ${warnLines})`);
      } else if (fn.lines > warnLines) {
        violation("warn", "fn-long", `${fn.name}() is ${fn.lines} lines`, `Consider extracting a helper (style target ≤ ${warnLines})`);
      }
    }
  }

  // ── Nesting depth ────────────────────────────────────────────────
  for (const fn of stats.functions) {
    if (fn.maxDepth > 4) {
      violation("error", "nesting-deep", `${fn.name}() nests ${fn.maxDepth} levels`, "Invert conditions and return early; extract branches into functions");
    } else if (fn.maxDepth === 4) {
      violation("warn", "nesting-deep", `${fn.name}() nests ${fn.maxDepth} levels`, "Guard clauses would flatten this");
    }
  }

  // ── Parameter count ──────────────────────────────────────────────
  for (const fn of stats.functions) {
    if (fn.params > 4) {
      violation("warn", "too-many-params", `${fn.name}() takes ${fn.params} params`, "Group related params into an options object");
    }
  }

  // ── Long lines / long file ───────────────────────────────────────
  const longLines = stats.lineLengths
    .map((len, i) => ({ len, i }))
    .filter(({ len }) => len > 120);
  if (longLines.length > 0) {
    violation("warn", "long-lines", `${longLines.length} line(s) over 120 chars (first at ${longLines[0].i + 1})`, "Wrap; long lines hide structure");
  }
  if (stats.lines > 400) {
    violation("warn", "long-file", `${stats.lines} lines`, "Split the module by responsibility");
  }

  // ── Duplicate blocks (normalized) ────────────────────────────────
  for (const dup of stats.duplicates) {
    violation("warn", "duplicate-block", `${dup.lines} identical lines × ${dup.count} (first: '${dup.head}')`, "Extract a shared function/constant");
  }

  // ── Debug leftovers ──────────────────────────────────────────────
  const debugErrors = [...structural.matchAll(DEBUG_ERROR)].length;
  if (debugErrors > 0) {
    violation("error", "debug-leftover", `${debugErrors} debug call(s)`, "Remove before delivering");
  }
  const debugNoise = [...source.matchAll(/\b(?:console\.warn|logger\.debug)\s*\(/gu)].length;
  if (debugNoise > 2) {
    violation("info", "debug-noise", `${debugNoise} warn/debug log calls`, "Keep logging deliberate, not sprinkled");
  }

  // ── Empty catch ──────────────────────────────────────────────────
  if (active.has("noEmptyCatch")) {
    const emptyCatch = source.match(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/gu) ?? [];
    const pyPass = source.match(/except[^\n:]*:\s*\n\s*pass/gu) ?? [];
    if (emptyCatch.length + pyPass.length > 0) {
      violation("error", "empty-catch", `${emptyCatch.length + pyPass.length} swallowed error(s)`, "Handle with context, rethrow enriched, or validate before");
    }
  }

  // ── Dead imports ─────────────────────────────────────────────────
  if (active.has("deadImports")) {
    for (const name of stats.imports) {
      const uses = new RegExp(`\\b${escapeRe(name)}\\b`, "gu");
      const count = [...source.matchAll(uses)].length;
      if (count <= 1) {
        violation("warn", "dead-import", `import ${name} unused`, "Remove it");
      }
    }
  }

  // ── else after return ────────────────────────────────────────────
  if (lang === "js") {
    const elseAfterReturn = source.match(/\breturn\s+[^;\n]+;\s*\}\s*else\s*\{/gu) ?? [];
    if (elseAfterReturn.length > 0) {
      violation("info", "else-after-return", `${elseAfterReturn.length} else-after-return`, "Return early and drop the else");
    }
  }

  // ── TODO left behind ─────────────────────────────────────────────
  const todos = source.match(/\b(?:TODO|FIXME|XXX)\b[^\n]*/gu) ?? [];
  if (todos.length > 0) {
    violation("info", "todo-left", todos.length === 1 ? todos[0] : `${todos.length} TODO/FIXME markers`, "Deliver without, or point each at an issue id");
  }

  // ── Naming ───────────────────────────────────────────────────────
  if (active.has("namesRevealIntent")) {
    const shorts = [...source.matchAll(/^(?![^\n]*\bfor\b).*?\b(?:const|let|var)\s+([a-z])\s*=/gmu)].map((m) => m[1]);
    if (shorts.length > 0) {
      violation("warn", "cryptic-name", `single-letter vars: ${[...new Set(shorts)].slice(0, 5).join(", ")}`, "Name by intent; single letters only for tight loop counters");
    }
  }
  if (active.has("namingConsistency") || active.has("matchOriginal")) {
    const mix = namingMix(source);
    if (mix.camel > 0 && mix.snake > 0 && mix.camel + mix.snake >= 6) {
      violation("warn", "naming-mixed", `${mix.camel} camelCase vs ${mix.snake} snake_case identifiers`, "Pick the file's dominant convention");
    }
  }

  // ── Magic numbers ────────────────────────────────────────────────
  if (active.has("noMagicNumbers")) {
    const magic = [...source.matchAll(/(?<![\w.])\d{2,}(?:\.\d+)?(?!\d*\s*[;)\]}]?\s*$)/gu)]
      .map((m) => m[0])
      .filter((n) => !["10", "100", "1000"].includes(n));
    const unique = [...new Set(magic)].slice(0, 5);
    if (unique.length > 0) {
      violation("warn", "magic-number", unique.join(", "), "Extract a named constant with a unit when relevant");
    }
  }

  // ── early returns (clean) ───────────────────────────────────────
  if (active.has("earlyReturns")) {
    const nestedIfs = (source.match(/\bif\b[^\n{]*\{\s*\n\s*\bif\b/gu) ?? []).length;
    if (nestedIfs > 0) {
      violation("warn", "nested-guard", `${nestedIfs} if directly inside if`, "Invert the outer condition and return early");
    }
  }

  // ── functional: let discipline and param mutation ─────────────────
  if (active.has("constOverLet")) {
    for (const lets of stats.reassignedNever) {
      violation("info", "let-could-be-const", `let ${lets} never reassigned`, "Use const");
    }
  }
  if (active.has("pureTransforms")) {
    const pushOnParams = lang === "js"
      ? (source.match(/\w+\.push\s*\(/gu) ?? []).length
      : (source.match(/\.append\s*\(/gu) ?? []).length;
    if (pushOnParams > 3) {
      violation("info", "mutation-heavy", `${pushOnParams} in-place append calls`, "Prefer map/filter/reduce returning new values");
    }
  }

  // ── solid: class bands, god switch ───────────────────────────────
  if (active.has("classSizeBands")) {
    for (const fn of stats.functions) {
      if (fn.kind === "class") {
        if (fn.lines > 200) {
          violation("error", "god-class", `${fn.name} is ${fn.lines} lines`, "Split responsibilities; a class over 200 lines is doing >1 job");
        } else if (fn.lines > 120) {
          violation("warn", "class-large", `${fn.name} is ${fn.lines} lines`, "Watch for a second responsibility creeping in");
        }
      }
    }
  }
  if (active.has("noGodSwitch")) {
    for (const m of source.matchAll(/switch\s*\([^)]+\)\s*\{/gu)) {
      const tail = source.slice(m.index ?? 0, (m.index ?? 0) + 900);
      const cases = (tail.match(/\bcase\b/gu) ?? []).length;
      if (cases > 6) {
        violation("warn", "god-switch", `switch with ${cases} cases`, "Table-driven lookup or polymorphism (open/closed)");
      }
    }
  }
  if (active.has("injectedDeps")) {
    const news = (source.match(/\bnew\s+[A-Z]\w*\s*\(/gu) ?? []).length;
    const insideClass = (source.match(/(?:this\.\w+\s*=\s*)?new\s+[A-Z]\w*\s*\(/gu) ?? []).length;
    if (insideClass > 0 && news > 0) {
      violation("warn", "constructed-deps", `${insideClass} constructed-in-class`, "Inject collaborators; construction is a composition-root job");
    }
  }
  if (active.has("noSwallowedDefaults")) {
    const nullishChain = (source.match(/\?\?\s*(?:\d+|true|false|"[^"]+")/gu) ?? []).length;
    if (nullishChain > 2) {
      violation("warn", "default-masking", `${nullishChain} literal fallbacks via ??/||`, "Validate at the boundary and fail fast instead of inventing data");
    }
  }
  if (active.has("switchHasDefault")) {
    for (const m of source.matchAll(/switch\s*\([^)]+\)\s*\{/gu)) {
      const tail = source.slice(m.index ?? 0, (m.index ?? 0) + 900);
      if (!/\bdefault\b/u.test(tail.split(/\bcase\b/u)[0] + tail) || !/\bdefault\b/u.test(tail)) {
        violation("warn", "switch-no-default", "switch without default", "Add an explicit default that fails or documents");
      }
    }
  }

  // ── minimal-diff: consistency with the original file ─────────────
  if (active.has("matchOriginal") && original !== undefined && String(original).trim().length > 0) {
    const host = indentProfile(String(original));
    const mine = indentProfile(source);
    if (host.style !== null && mine.style !== null && host.style !== mine.style) {
      violation("error", "indent-mismatch", `file uses ${host.style} (width ${host.width}), patch uses ${mine.style} (width ${mine.width})`, "Match the host file's indentation");
    } else if (host.style === mine.style && host.width !== mine.width && host.style === "space") {
      violation("error", "indent-width", `file indents ${host.width} spaces, patch uses ${mine.width}`, "Match the file's indent width");
    }
    const hostQuotes = quoteStyle(String(original));
    const myQuotes = quoteStyle(source);
    if (hostQuotes !== null && myQuotes !== null && hostQuotes !== myQuotes) {
      violation("warn", "quote-mismatch", `file uses ${hostQuotes} quotes, patch uses ${myQuotes}`, "Match the file's quoting");
    }
    const hostNaming = dominantNaming(String(original));
    const myNaming = dominantNaming(source);
    if (hostNaming !== null && myNaming !== null && hostNaming !== myNaming) {
      violation("warn", "naming-mismatch", `file is ${hostNaming}, patch is ${myNaming}`, "New identifiers follow the file's convention");
    }
    const hostRate = semicolonRate(String(original));
    const myRate = semicolonRate(source);
    if (Math.abs(hostRate - myRate) > 0.4) {
      violation("info", "semicolon-style", `file ends ${Math.round(hostRate * 100)}% of statements with ';', patch ${Math.round(myRate * 100)}%`, "Match the file's statement endings");
    }
  }

  const score = computeScore(violations);
  return {
    style,
    language: lang,
    stats: {
      lines: stats.lines,
      functions: stats.functions.length,
      classes: stats.functions.filter((fn) => fn.kind === "class").length,
      maxFnLines: stats.functions.reduce((a, fn) => Math.max(a, fn.lines), 0),
      avgFnLines: stats.functions.length > 0
        ? Math.round(stats.functions.reduce((a, fn) => a + fn.lines, 0) / stats.functions.length)
        : 0,
      maxDepth: stats.functions.reduce((a, fn) => Math.max(a, fn.maxDepth), 0),
    },
    violations,
    score,
    pass: score >= 85 && !violations.some((item) => item.severity === "error"),
  };
}

// ── analysis helpers ────────────────────────────────────────────────

function analyze(source, lang) {
  const lines = (lang === "js" ? maskJsLiterals(source) : source).split(/\r?\n/u);
  const functions = [];
  const starters = FN_STARTERS[lang];
  for (const starter of starters) {
    starter.lastWeight = 0;
  }
  const opens = [];
  for (const [i, line] of lines.entries()) {
    for (const starter of starters) {
      starter.lastIndex = 0;
      for (const m of line.matchAll(starter)) {
        opens.push({ line: i, name: m[1] ?? "(anonymous)", kind: starter.source.includes("class") ? "class" : "fn" });
      }
    }
    if (opens.length > 0) {
      const last = opens[opens.length - 1];
      last.end = undefined;
    }
  }
  // Compute extents: JS/TS via brace matching from the starter line.
  if (lang === "js") {
    for (const open of opens) {
      let depth = 0;
      let started = false;
      let maxDepth = 0;
      const paramMatch = lines[open.line]?.match(/\(([^)]*)\)/);
      open.params = paramMatch === null ? 0 : paramMatch[1].split(",").filter((p) => p.trim().length > 0).length;
      for (let i = open.line; i < lines.length && i < open.line + 400; i += 1) {
        for (const ch of lines[i]) {
          if (ch === "{") {
            depth += 1;
            started = true;
            maxDepth = Math.max(maxDepth, depth);
          } else if (ch === "}") {
            depth -= 1;
            if (started && depth === 0) {
              open.end = i;
            }
          }
          if (started && open.end !== undefined) break;
        }
        if (open.end !== undefined) break;
      }
      if (open.end === undefined) open.end = Math.min(lines.length - 1, open.line + 40);
      open.lines = open.end - open.line + 1;
      open.maxDepth = Math.max(1, maxDepth - 1);
    }
  } else {
    // Python: extent by indentation.
    for (const open of opens) {
      const headerIndent = indentWidth(lines[open.line]);
      let end = open.line;
      for (let i = open.line + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim().length === 0) continue;
        if (indentWidth(line) <= headerIndent) break;
        end = i;
      }
      open.end = end;
      open.lines = end - open.line + 1;
      const paramMatch = lines[open.line]?.match(/\(([^)]*)\)/);
      open.params = paramMatch === null ? 0 : paramMatch[1].split(",").filter((p) => p.trim().length > 0).length;
      let maxDepth = 0;
      for (let i = open.line; i <= end; i += 1) {
        if (lines[i].trim().length > 0) {
          maxDepth = Math.max(maxDepth, Math.round((indentWidth(lines[i]) - headerIndent) / 4));
        }
      }
      open.maxDepth = maxDepth;
    }
  }
  const kept = dedupeOverlaps(opens);
  return {
    lines: lines.length,
    lineLengths: lines.map((l) => l.length),
    functions: kept,
    imports: collectImports(source, lang),
    duplicates: findDuplicates(lines),
    reassignedNever: letNeverReassigned(source),
  };
}

function dedupeOverlaps(opens) {
  const kept = [];
  for (const open of [...opens].sort((a, b) => a.line - b.line)) {
    const overlaps = kept.some((k) => open.line >= k.line && open.line <= (k.end ?? k.line));
    if (!overlaps) kept.push(open);
  }
  return kept;
}

function collectImports(source, lang) {
  const names = [];
  if (lang === "js") {
    for (const m of source.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))(?:\s*,\s*\{([^}]+)\})?\s+from/gu)) {
      for (const group of [m[1], m[2], m[3]]) {
        if (group !== undefined) {
          for (const part of group.split(",")) {
            const name = part.trim().split(/\s+as\s+/u).at(-1).trim();
            if (name.length > 0) names.push(name);
          }
        }
      }
    }
    for (const m of source.matchAll(/const\s+\{([^}]+)\}\s*=\s*require\(/gu)) {
      for (const part of m[1].split(",")) {
        const name = part.trim();
        if (name.length > 0) names.push(name);
      }
    }
  } else {
    for (const m of source.matchAll(/^\s*from\s+\S+\s+import\s+(.+)$/gmu)) {
      for (const part of m[1].replace(/[()]/gu, "").split(",")) {
        const name = part.trim();
        if (/^[A-Za-z_]\w*$/u.test(name)) names.push(name);
      }
    }
  }
  return [...new Set(names)];
}

function findDuplicates(lines) {
  const normalized = lines.map((line) => line.trim()).filter((line) => line.length > 12);
  const seen = new Map();
  for (const line of normalized) {
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  // Report exact-line families repeated ≥ 5 times (normalized).
  const dups = [];
  for (const [line, count] of seen) {
    if (count >= 5) {
      dups.push({ lines: 1, count, head: line.slice(0, 40) });
    }
  }
  return dups.slice(0, 3);
}

function letNeverReassigned(source) {
  const never = [];
  for (const m of source.matchAll(/\blet\s+([A-Za-z_$][\w$]*)\s*=/gu)) {
    const name = m[1];
    const assigns = [...source.matchAll(new RegExp(`\\b${escapeRe(name)}\\s*=[^=]`, "gu"))].length;
    const updated = new RegExp(String.raw`\b${escapeRe(name)}\s*(?:\+\+|--|(?:\+|-|\*|\/|%|&&|\|\||\?\?|<<|>>|>>>|&|\||\^)=)|(?:\+\+|--)\s*\b${escapeRe(name)}\b`, "u").test(source);
    if (assigns <= 1 && !updated) never.push(name);
  }
  return [...new Set(never)].slice(0, 5);
}

function indentWidth(line) {
  const match = line.match(/^[ \t]*/u);
  const prefix = match === null ? "" : match[0];
  if (prefix.includes("\t")) return prefix.split("\t").length * 4 - (4 - (prefix.length - prefix.lastIndexOf("\t") - 1));
  return prefix.length;
}

function indentProfile(source) {
  const indents = source.split(/\r?\n/u)
    .map((l) => l.match(/^([ \t]+)\S/u)?.[1] ?? "")
    .filter((prefix) => prefix.length > 0);
  if (indents.length === 0) return { style: null, width: 0 };
  const tabs = indents.filter((p) => p.includes("\t")).length;
  const spaces = indents.length - tabs;
  const style = tabs > spaces ? "tab" : "space";
  const widths = indents
    .filter((p) => (style === "tab" ? p.includes("\t") : !p.includes("\t")))
    .map((p) => (style === "tab" ? 4 : p.length))
    .filter((w) => w > 0);
  const width = widths.length > 0 ? widths.reduce((a, b) => { while (b) [a, b] = [b, a % b]; return a; }) : 0;
  return { style, width };
}

function semicolonRate(source) {
  const lines = source.split(/\n/u).filter((l) => /\S/u.test(l) && !/^\s*(?:\/\/|\/\*|\*)/u.test(l));
  if (lines.length === 0) return 0;
  const semid = lines.filter((l) => /;\s*$/u.test(l)).length;
  return semid / lines.length;
}

function quoteStyle(source) {
  const doubles = (source.match(/"[^"\n]{2,}"/gu) ?? []).length;
  const singles = (source.match(/'[^'\n]{2,}'/gu) ?? []).length;
  if (doubles + singles < 2) return null;
  return doubles > singles ? "double" : "single";
}

function dominantNaming(source) {
  const camel = (source.match(/\b[a-z]+[A-Z]\w*\b/gu) ?? []).length;
  const snake = (source.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/gu) ?? []).length;
  if (camel + snake < 4) return null;
  return camel > snake ? "camelCase" : "snake_case";
}

function namingMix(source) {
  return {
    camel: (source.match(/\b(?:const|let|var|function|def)\s+[a-z]+[A-Z]\w*/gu) ?? []).length,
    snake: (source.match(/\b(?:const|let|var|function|def)\s+[a-z]+(?:_[a-z0-9]+)+\b/gu) ?? []).length,
  };
}

function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function computeScore(violations) {
  const weights = { error: 12, warn: 5, info: 2 };
  return Math.max(0, 100 - violations.reduce((a, v) => a + (weights[v.severity] ?? 2), 0));
}

/** Position-preserving lexical mask for JS strings/comments; not a parser. */
function maskJsLiterals(source) {
  return source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu,
    (value) => value.replace(/[^\r\n]/gu, " "));
}
