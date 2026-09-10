/**
 * MIME tree walking over Gmail's format=full payload structures —
 * zero-dependency body extraction (text/plain preferred, HTML stripped),
 * quoted-printable decoding, and attachment metadata. Pure functions.
 */

export function header(payload, name) {
  const target = name.toLowerCase();
  const hit = (payload.headers ?? []).find((entry) => entry.name.toLowerCase() === target);
  return hit === undefined ? null : hit.value;
}

/**
 * Best plain-text rendering of a message payload: text/plain part when
 * present, else text/html with tags stripped. `snippet` is the fallback.
 */
export function bodyText(payload, snippet = "") {
  const parts = collectParts(payload);
  const plain = parts.find((part) => part.mimeType === "text/plain" && !part.filename && typeof part.data === "string");
  if (plain !== undefined) return decodeBody(plain);
  const html = parts.find((part) => part.mimeType === "text/html" && !part.filename && typeof part.data === "string");
  if (html !== undefined) return htmlToText(decodeBody(html));
  return snippet;
}

export function attachments(payload) {
  return collectParts(payload)
    .filter((part) => part.filename !== undefined && part.filename !== null && part.filename !== "")
    .map((part) => ({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      sizeBytes: part.body?.size ?? 0,
      attachmentId: part.body?.attachmentId ?? null,
      partId: part.partId ?? null,
    }));
}

export function listUnsubscribe(payload) {
  const value = header(payload, "List-Unsubscribe");
  if (value === null) return null;
  const mailto = value.match(/<mailto:([^>]+)>/iu);
  const https = value.match(/<(https?:\/\/[^>]+)>/iu);
  return {
    raw: value,
    ...(mailto !== null ? { mailto: mailto[1] } : {}),
    ...(https !== null ? { url: https[1] } : {}),
  };
}

/** Walk multipart trees breadth-first, flattening nested alternatives. */
export function collectParts(payload) {
  const out = [];
  const queue = [payload];
  while (queue.length > 0) {
    const part = queue.shift();
    if (part === undefined) continue;
    out.push({
      partId: part.partId,
      mimeType: part.mimeType ?? null,
      filename: part.filename ?? null,
      headers: part.headers ?? [],
      body: part.body ?? {},
      // Leaf data lives in body.data; keep it addressable for decode.
      data: part.body?.data ?? null,
    });
    for (const child of part.parts ?? []) queue.push(child);
  }
  return out;
}

export function decodeBody(part) {
  const data = part.data ?? part.body?.data ?? null;
  if (data === null) return "";
  const buffer = Buffer.from(data, "base64");
  // Gmail format=full has already decoded MIME Content-Transfer-Encoding.
  // body.data is base64url, not another quoted-printable layer.
  return buffer.toString("utf8");
}

function encodingOf(part) {
  const hit = (part.headers ?? []).find((entry) => entry.name.toLowerCase() === "content-transfer-encoding");
  return hit === undefined ? null : hit.value.toLowerCase();
}

export function decodeQuotedPrintable(text) {
  const softBroken = text.replace(/=\r?\n/gu, "");
  const bytes = [];
  for (let i = 0; i < softBroken.length; i += 1) {
    const ch = softBroken[i];
    if (ch === "=" && /[0-9A-F]{2}/iu.test(softBroken.slice(i + 1, i + 3))) {
      bytes.push(parseInt(softBroken.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Tag-stripping with the basics: block breaks, link hrefs preserved as text. */
export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/giu, "")
    .replace(/<style[\s\S]*?<\/style>/giu, "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/giu, "\n")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu, "$2 ($1)")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function emailAddress(value) {
  const match = String(value ?? "").match(/<([^>]+)>/u);
  return (match !== null ? match[1] : String(value ?? "")).trim().toLowerCase();
}

export function emailDomain(address) {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).toLowerCase();
}
