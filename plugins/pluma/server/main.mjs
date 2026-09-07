#!/usr/bin/env node
/**
 * pluma MCP server — writing styles with a deterministic verifier.
 *
 * Zero-dependency stdio MCP server (JSON-RPC 2.0, newline-delimited),
 * fully offline. The style LIBRARY ships as AgenC output styles (see
 * outputStyles/, selectable with /output-style); this server contributes
 * the missing half of the loop: `style_lint` verifies a draft against
 * the style's deterministic ruleset (register, structure, length,
 * readability, required sections) and returns violations with fixes.
 * The model writes; this judges. No network, no state.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STYLE_RULESETS, lintText } from "./lint.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "pluma", version: "0.2.1" };
const STYLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "outputStyles");

const tools = [
  {
    name: "styles_list",
    description: "The pluma style library: tones (voice) and forms (document structure), each with its deterministic lint ruleset. Select one as a session-wide AgenC output style with /output-style, or apply it per-document through style_lint.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const styles = [];
      for (const [key, ruleset] of Object.entries(STYLE_RULESETS)) {
        let description = null;
        try {
          const raw = await readFile(join(STYLES_DIR, `${key}.md`), "utf8");
          const match = raw.match(/^---\n([\s\S]*?)\n---/u);
          description = match?.[1]?.match(/description:\s*(.+)/u)?.[1]?.trim() ?? null;
        } catch {
          // style file missing: still list the ruleset
        }
        styles.push({
          key,
          family: ruleset.family,
          ...(ruleset.tone !== undefined ? { carriesTone: ruleset.tone } : {}),
          ...(description !== null ? { description } : {}),
          lintRules: [...new Set([...ruleset.rules, ...(ruleset.tone !== undefined ? STYLE_RULESETS[ruleset.tone].rules : [])])],
        });
      }
      return structured({
        styles,
        hint: "Session-wide voice: /output-style <name>. Per-document: draft, then style_lint, then fix the violations it reports.",
      });
    },
  },
  {
    name: "style_lint",
    description: "Verify a draft against one style's deterministic ruleset: register (fillers, slang, hedges, contractions, exclamations/emoji, first-person opinion, vague quantities), structure (salutation/closing, required sections, CTA, hook), length bands and readability. Returns violations with severity, excerpt and concrete fix, plus a 0-100 score (pass ≥ 85).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The draft to verify" },
        style: { type: "string", enum: Object.keys(STYLE_RULESETS) },
        subject: { type: "string", description: "Email subject line, for email-profesional's subject checks" },
      },
      required: ["text", "style"],
    },
    handler: async ({ text: draft, style, subject }) => {
      const result = lintText(draft, style, { subject });
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
        process.stderr.write(`pluma: unparseable line: ${line.slice(0, 120)}\n`);
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
  process.stderr.write(`pluma fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
