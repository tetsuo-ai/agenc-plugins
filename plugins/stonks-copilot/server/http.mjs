/** Bounded public-data reads. Redirects cannot move a request to another host. */
export async function fetchPublic(url, {
  fetchImpl = globalThis.fetch, headers = {}, format = "json", maxBytes = 16 * 1024 * 1024,
  timeoutMs = 15000, allowNotFound = false,
} = {}) {
  if (new URL(url).protocol !== "https:") throw new Error("public data requests require HTTPS");
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`public data request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const read = async () => {
    const response = await fetchImpl(url, { headers, redirect: "error", signal: controller.signal });
    if (response.redirected) throw new Error("public data redirects are not allowed");
    if (response.status === 404 && allowNotFound) return null;
    if (!response.ok) throw new Error(`public data request failed: HTTP ${response.status}`);
    if (Number(response.headers?.get?.("content-length")) > maxBytes) throw new Error("public data response exceeds size limit");
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) throw new Error("public data response exceeds size limit");
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        text = chunks.join("");
      } finally { await reader.cancel().catch(() => {}); }
    } else if (response.text) text = await response.text();
    else text = JSON.stringify(await response.json());
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("public data response exceeds size limit");
    return format === "text" ? text : JSON.parse(text);
  };
  try { return await Promise.race([read(), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}
