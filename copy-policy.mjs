import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";

// This is a regression guard, not a general-purpose language detector.
const SPANISH_COPY = /[\u00bf\u00a1]|\b(?:escrib[eí]|escrib[ae]mos|hazme|hac[eé]|redacta|convierte|prep[aá]rame|expl[ií]came|ay[uú]dame|mu[eé]strame|pedido|archivo|c[oó]digo|revis[aá]|pr[aá]ctica|t[eé]cnica|pista|soluci[oó]n|estilo|b[uú]squeda|cartera|cancelaci[oó]n|vencimiento|limpio|defensivo|funcional|cercano|directo|persuasivo|t[eé]cnico|discurso|propuesta|calidad|escritura|olimpiada)\b/iu;
const EM_DASH = /\u2014|\\u(?:2014|\{2014\})|&mdash;|&#(?:0*8212|x0*2014);/iu;
const TEXT_EXTENSIONS = /\.(?:md|json|[cm]?js|ts|sh|ya?ml|txt|html|svg|css)$/iu;
const COPY_FIELDS = new Set([
  "displayName", "description", "shortDescription", "longDescription",
  "defaultPrompt", "argumentHint", "title", "label", "placeholder", "help",
]);

export function copyIssues(text, { english = false } = {}) {
  const issues = [];
  if (EM_DASH.test(text)) issues.push("em dashes are not allowed");
  // Backticked identifiers and explicit English references to legacy commands
  // are compatibility documentation, not Spanish prose.
  const prose = text.replace(/`[^`]*`/gu, "").replace(
    /\b(?:codigo|escribe|olimpo|limpio|defensivo|funcional|cercano|directo|persuasivo|tecnico|discurso|propuesta|calidad|escritura|olimpiada) (?:command|tool|plugin|skill|style|alias|identifier)\b/giu, "",
  );
  if (english && SPANISH_COPY.test(prose)) issues.push("translate authored copy to English");
  return issues;
}

export function manifestCopyIssues(value, path = "manifest", { language = true } = {}) {
  function walk(child, label, inCopy = false) {
    if (typeof child === "string") {
      return copyIssues(child, { english: inCopy }).map(issue => `${label}: ${issue}`);
    }
    if (child === null || typeof child !== "object") return [];
    return Object.entries(child).flatMap(([key, nested]) =>
      walk(nested, `${label}.${key}`, inCopy || (language && COPY_FIELDS.has(key))));
  }
  return walk(value, path);
}

export function frontmatterCopyIssues(text, label = "frontmatter") {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match) return [];
  const issues = [];
  let field;
  for (const line of match[1].split(/\r?\n/u)) {
    const entry = /^([\w-]+):\s*(.*)$/u.exec(line);
    if (entry) field = entry[1];
    const name = field?.replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
    if (COPY_FIELDS.has(name) || (name === "name" && /(?:^|\/)SKILL\.md$/u.test(label))) {
      issues.push(...copyIssues(entry ? entry[2] : line, { english: true })
        .map(issue => `${label}.${field}: ${issue}`));
    }
  }
  return [...new Set(issues)];
}

export function repositoryCopyIssues(root) {
  const issues = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      // Legal notices stay verbatim. Images are not prose.
      if (!entry.isFile() || /^(?:LICENSE|COPYING|NOTICE)(?:\.|$)/iu.test(basename(path))) continue;
      if (!TEXT_EXTENSIONS.test(path)) continue;
      const label = relative(root, path);
      const content = readFileSync(path, "utf8");
      issues.push(...copyIssues(content).map(issue => `${label}: ${issue}`));
      if (path.endsWith(".md")) issues.push(...frontmatterCopyIssues(content, label));
      // JSON parsing also catches escaped Unicode in manifests and payload data.
      if (path.endsWith(".json")) {
        issues.push(...manifestCopyIssues(JSON.parse(content), label, {
          language: path.endsWith(join(".agenc-plugin", "plugin.json")),
        }));
      }
    }
  }
  walk(join(root, "plugins"));
  for (const path of ["README.md", ".agenc-plugin/marketplace.json"]) {
    const content = readFileSync(join(root, path), "utf8");
    issues.push(...copyIssues(content).map(issue => `${path}: ${issue}`));
    if (path.endsWith(".json")) issues.push(...manifestCopyIssues(JSON.parse(content), path));
  }
  return [...new Set(issues)];
}
