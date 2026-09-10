#!/usr/bin/env node
/**
 * Forge MCP server: code-writing styles with a deterministic verifier.
 *
 * Zero-dependency stdio MCP server (JSON-RPC 2.0, newline-delimited),
 * fully offline. The style library ships as AgenC output styles (see
 * outputStyles/); this server contributes the loop's missing half:
 * `code_lint` runs heuristic structural analysis (JS/TS and Python) on
 * a draft: function bands, nesting, parameters, duplicates, naming,
 * debug leftovers, dead imports, per-style discipline, and (for
 * minimal-diff) measurable consistency with the original file being
 * edited. The model writes; this judges. No network, no state.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_STYLE_RULESETS, CODE_STYLE_ALIASES, CODE_STYLE_FILES, verifyCode } from "./verify.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "forja", title: "Forge", version: "0.2.5" };
const STYLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "outputStyles");

const tools = [
  {
    name: "code_styles_list",
    description: "List Forge's clean, defensive, functional, solid, and minimal-diff styles with their deterministic lint rules. For a session-wide style, open /output-style and select the installed plugin style matching outputStyleName. Exact IDs include an installation namespace. Check individual drafts with code_lint.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const styles = [];
      for (const [key, ruleset] of Object.entries(CODE_STYLE_RULESETS)) {
        let description = null;
        try {
          const raw = await readFile(join(STYLES_DIR, `${CODE_STYLE_FILES[key]}.md`), "utf8");
          const match = raw.match(/^---\n([\s\S]*?)\n---/u);
          description = match?.[1]?.match(/description:\s*(.+)/u)?.[1]?.trim() ?? null;
        } catch {
          // style file missing: still list the ruleset
        }
        styles.push({
          key,
          outputStyleName: CODE_STYLE_FILES[key],
          family: ruleset.family,
          ...(description !== null ? { description } : {}),
          lintRules: ruleset.rules,
          baseRules: "function bands, nesting depth, param count, long lines/files, duplicate blocks, naming consistency, debug leftovers, empty catch, dead imports, else-after-return, TODO markers",
        });
      }
      return structured({
        styles,
        hint: "For new code, choose a discipline, draft, run code_lint, and revise. For existing code, use minimal-diff and provide original so the checker can compare the file's indentation, quotes, and naming.",
      });
    },
  },
  {
    name: "code_lint",
    description: "Check a JS/TS or Python draft with structural heuristics for function length, nesting, parameters, duplication, naming, debug leftovers, unused imports, and the chosen discipline. With minimal-diff and original, also compare indentation, quotes, naming, and semicolons with the existing file. Returns findings, suggestions, and a 0-100 score. Passing requires at least 85 and no errors; this does not replace compilation or tests.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The draft source" },
        style: { type: "string", enum: [...Object.keys(CODE_STYLE_RULESETS), ...Object.keys(CODE_STYLE_ALIASES)], description: "English style name; legacy input aliases remain accepted" },
        language: { type: "string", enum: ["js", "py"], description: "js covers TS; py covers Python" },
        original: { type: "string", description: "For minimal-diff: the file's current contents" },
      },
      required: ["code", "style"],
    },
    handler: async ({ code, style, language, original }) => {
      const result = verifyCode(code, { style, language, original });
      if (result.error !== undefined) return text(result.error);
      return structured(result);
    },
  },
];

function text(value) {
  return { content: [{ type: "text", text: String(value) }] };
}

function structured(value) {
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

async function handleMessage(message) {
  if (message === null || typeof message !== "object") return null;
  const { id, method, params } = message;
  const isNotification = id === undefined;
  if (isNotification) return null;
  try {
    if (method === "initialize") {
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return null;
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
      return reply(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }
    if (method === "tools/call") {
      const name = params?.name;
      const tool = toolByName.get(name);
      if (tool === undefined) {
        return isNotification ? null : reply(id, null, { code: -32602, message: `unknown tool: ${name}` });
      }
      const result = await tool.handler(params?.arguments ?? {});
      return isNotification ? null : reply(id, result);
    }
    return isNotification ? null : reply(id, null, { code: -32601, message: `method not found: ${method}` });
  } catch (error) {
    if (isNotification) return null;
    return reply(id, null, {
      code: -32000,
      message: `tool error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function reply(id, result, error) {
  const response = { jsonrpc: "2.0", id };
  if (error !== undefined) response.error = error;
  else response.result = result;
  return response;
}

async function main() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stderr.write("Forge: invalid JSON-RPC input\n");
        continue;
      }
      const response = await handleMessage(message);
      if (response !== null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`Forge fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
