/** Match Core's supported image containers before choosing a display MIME. */
import * as zlib from "node:zlib";

const ascii = (bytes, start, end) => bytes.toString("ascii", start, end);
const validSize = (width, height) => width > 0 && height > 0;

export function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return validPng(bytes) ? "image/png" : null;
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return validJpeg(bytes) ? "image/jpeg" : null;
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) {
    return validGif(bytes) ? "image/gif" : null;
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return validWebp(bytes) ? "image/webp" : null;
  }
  return null;
}

function validPng(bytes) {
  if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || ascii(bytes, 12, 16) !== "IHDR" || !pngCrc(bytes, 8, 13)) return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const depth = bytes[24], color = bytes[25];
  const depthOk = (color === 0 && [1, 2, 4, 8, 16].includes(depth)) ||
    (color === 2 && [8, 16].includes(depth)) ||
    (color === 3 && [1, 2, 4, 8].includes(depth)) ||
    ([4, 6].includes(color) && [8, 16].includes(depth));
  if (!validSize(width, height) || !depthOk || bytes[26] !== 0 || bytes[27] !== 0 || ![0, 1].includes(bytes[28])) return false;
  let offset = 33, palette = false, image = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = ascii(bytes, offset + 4, offset + 8);
    if (length > 0x7fffffff || !/^[A-Za-z]{4}$/u.test(type) || offset + 12 + length > bytes.length) return false;
    if (/^[A-Z]/u.test(type) && !pngCrc(bytes, offset, length)) return false;
    if (type === "PLTE") palette = true;
    if (type === "IDAT") { if (color === 3 && !palette) return false; image = true; }
    if (type === "IEND") return image;
    offset += 12 + length;
  }
  return false;
}

function pngCrc(bytes, offset, length) {
  const data = bytes.subarray(offset + 4, offset + 8 + length);
  return checksum(data) === bytes.readUInt32BE(offset + 8 + length);
}

function checksum(bytes) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(bytes) >>> 0;
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function validJpeg(bytes) {
  let offset = 2, frame = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 255) return false;
    while (offset < bytes.length && bytes[offset] === 255) offset++;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (marker === 217 || offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    const sof = (marker >= 192 && marker <= 195) || (marker >= 197 && marker <= 199) ||
      (marker >= 201 && marker <= 203) || (marker >= 205 && marker <= 207);
    if (sof) {
      if (length < 8 || !validSize(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))) return false;
      frame = true;
    }
    if (marker === 218) return frame && bytes.lastIndexOf(Buffer.from([255, 217])) >= offset + length;
    offset += length;
  }
  return false;
}

function skipGifBlocks(bytes, start) {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset++];
    if (size === 0) return offset;
    offset += size;
    if (offset > bytes.length) return null;
  }
  return null;
}

function validGif(bytes) {
  if (bytes.length < 13 || !validSize(bytes.readUInt16LE(6), bytes.readUInt16LE(8))) return false;
  let offset = 13, frames = 0;
  if (bytes[10] & 128) offset += 3 * 2 ** ((bytes[10] & 7) + 1);
  if (offset > bytes.length) return false;
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 59) return frames > 0;
    if (block === 33) {
      if (offset + 2 > bytes.length) return false;
      offset = skipGifBlocks(bytes, offset + 2);
    } else if (block === 44) {
      if (offset + 10 > bytes.length) return false;
      const packed = bytes[offset + 9];
      offset += 10;
      if (packed & 128) offset += 3 * 2 ** ((packed & 7) + 1);
      if (offset + 1 > bytes.length) return false;
      offset = skipGifBlocks(bytes, offset + 1);
      frames++;
    } else return false;
    if (offset === null) return false;
  }
  return frames > 0;
}

function riffChunks(bytes, start, end) {
  const chunks = [];
  let offset = start;
  while (offset + 8 <= end) {
    const type = ascii(bytes, offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8, dataEnd = dataStart + size;
    if (dataEnd > end) return null;
    chunks.push({ type, size, dataStart, dataEnd });
    offset = dataEnd + (size & 1);
  }
  return chunks;
}

function webpBitstream(bytes, chunk) {
  const at = chunk.dataStart;
  if (chunk.type === "VP8 ") {
    if (chunk.size < 10) return false;
    const tag = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    return (tag & 1) === 0 && bytes[at + 3] === 157 && bytes[at + 4] === 1 && bytes[at + 5] === 42 &&
      10 + ((tag >>> 5) & 0x7ffff) <= chunk.size &&
      validSize(bytes.readUInt16LE(at + 6) & 0x3fff, bytes.readUInt16LE(at + 8) & 0x3fff);
  }
  if (chunk.type !== "VP8L" || chunk.size < 5 || bytes[at] !== 47) return false;
  const bits = bytes.readUInt32LE(at + 1);
  return bits >>> 29 === 0;
}

function validWebp(bytes) {
  const end = bytes.readUInt32LE(4) + 8;
  if (end > bytes.length) return false;
  const chunks = riffChunks(bytes, 12, end), first = chunks?.[0];
  if (!first) return false;
  if (["VP8 ", "VP8L"].includes(first.type)) return webpBitstream(bytes, first);
  if (first.type !== "VP8X" || first.size < 10) return false;
  const width = 1 + bytes.readUIntLE(first.dataStart + 4, 3), height = 1 + bytes.readUIntLE(first.dataStart + 7, 3);
  if (!validSize(width, height)) return false;
  if (bytes[first.dataStart] & 2) {
    if (!chunks.some((chunk) => chunk.type === "ANIM")) return false;
    const frames = chunks.filter((chunk) => chunk.type === "ANMF");
    return frames.length > 0 && frames.every((frame) => {
      if (frame.size < 16) return false;
      const inner = riffChunks(bytes, frame.dataStart + 16, frame.dataEnd);
      const image = inner?.find((chunk) => ["VP8 ", "VP8L"].includes(chunk.type));
      return image !== undefined && webpBitstream(bytes, image);
    });
  }
  const image = chunks.find((chunk) => ["VP8 ", "VP8L"].includes(chunk.type));
  return image !== undefined && webpBitstream(bytes, image);
}
