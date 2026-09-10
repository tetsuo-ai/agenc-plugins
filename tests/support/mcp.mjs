import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

/** Real stdio transport in disposable storage; never uses a live profile. */
export async function withMcp(plugin, run, environment = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "agenc-plugin-review-"));
  const child = spawn(process.execPath, [resolve(`plugins/${plugin}/server/main.mjs`)], {
    env: { PATH: process.env.PATH, AGENC_PLUGIN_DATA: dataDir, ...environment }, stdio: ["pipe", "pipe", "pipe"],
  });
  const closed = once(child, "close");
  let nextId = 0, buffer = "", stderr = "";
  const pending = new Map();
  const responses = [];
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line); responses.push(message);
      const request = pending.get(message.id);
      if (request) { clearTimeout(request.timer); pending.delete(message.id); request.resolve(message); }
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}; ${stderr}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const tool = async (name, args = {}) => {
    const message = await call("tools/call", { name, arguments: args });
    if (message.error) throw new Error(message.error.message);
    return message.result.structuredContent ?? message.result.content[0].text;
  };
  try { await run({ call, tool, dataDir, responses, child }); }
  finally {
    for (const { timer } of pending.values()) clearTimeout(timer);
    child.kill(); await closed;
    rmSync(dataDir, { recursive: true, force: true });
  }
}
