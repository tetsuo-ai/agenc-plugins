import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const PLUGIN_MANIFEST_PATH = ".agenc-plugin/plugin.json";
export const PLUGIN_SIGNATURE_PATH = ".agenc-plugin/signature.json";
export const PLUGIN_INSTALL_METADATA_PATH = ".agenc-plugin/agenc-install.json";
export const PUBLISHER_PUBLIC_KEY_FILES = [
  "agenc-plugins.pub",
  "agenc-plugins-2026-09.pub",
];

const MAX_PAYLOAD_BYTES = 200 * 1024 * 1024;
const MAX_PAYLOAD_FILES = 4096;
const MAX_PAYLOAD_DEPTH = 32;
const VCS_DIRECTORIES = new Set([".git", ".hg", ".svn"]);

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

export function collectPluginPayloadDigests(pluginRoot) {
  const absoluteRoot = realpathSync(resolve(pluginRoot));
  const manifestReal = realpathSync(join(absoluteRoot, PLUGIN_MANIFEST_PATH));
  const signaturePath = join(absoluteRoot, PLUGIN_SIGNATURE_PATH);
  const signatureReal = (() => {
    try {
      return realpathSync(signaturePath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  })();
  const files = {};
  let fileCount = 0;
  let byteCount = 0;

  function walk(directory, depth) {
    if (depth > MAX_PAYLOAD_DEPTH) {
      throw new Error(`plugin payload exceeds maximum depth: ${depth}`);
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && VCS_DIRECTORIES.has(entry.name)) continue;
      const child = join(directory, entry.name);
      const childStat = lstatSync(child);
      if (childStat.isSymbolicLink()) {
        throw new Error(`plugin payload cannot contain symlinks: ${relative(absoluteRoot, child)}`);
      }
      const childReal = realpathSync(child);
      if (!isInside(childReal, absoluteRoot)) {
        throw new Error(`plugin payload escapes its root: ${relative(absoluteRoot, child)}`);
      }
      if (childStat.isDirectory()) {
        walk(child, depth + 1);
        continue;
      }
      if (!childStat.isFile()) continue;
      const rel = relative(absoluteRoot, child).split(sep).join("/");
      if (
        childReal === manifestReal ||
        childReal === signatureReal ||
        rel === PLUGIN_INSTALL_METADATA_PATH
      ) {
        continue;
      }
      fileCount += 1;
      byteCount += childStat.size;
      if (fileCount > MAX_PAYLOAD_FILES) {
        throw new Error(`plugin payload exceeds ${MAX_PAYLOAD_FILES} files`);
      }
      if (byteCount > MAX_PAYLOAD_BYTES) {
        throw new Error(`plugin payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
      }
      files[rel] = `sha256:${sha256Hex(readFileSync(child))}`;
    }
  }

  walk(absoluteRoot, 0);
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function pluginSignaturePayload(
  pluginRoot,
  files = collectPluginPayloadDigests(pluginRoot),
) {
  const manifest = readFileSync(join(pluginRoot, PLUGIN_MANIFEST_PATH));
  return Buffer.from(JSON.stringify({
    manifestSha256: sha256Hex(manifest),
    files: Object.fromEntries(
      Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
    ),
  }));
}

export function publisherPublicKeyBase64(pem) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("plugin publisher key must be Ed25519");
  }
  return Buffer.from(key.export({ format: "der", type: "spki" })).toString("base64");
}

/** Public-only overlap: keep historical signatures verifiable during rollover. */
export function readPublisherPublicKeys(repositoryRoot) {
  return PUBLISHER_PUBLIC_KEY_FILES.map((file) => {
    const pem = readFileSync(join(repositoryRoot, file), "utf8");
    publisherPublicKeyBase64(pem);
    return pem;
  });
}

export function verifyPluginSignatureFile(
  pluginRoot,
  publicKey,
  expectedPublisher = "tetsuo-ai",
) {
  const signatureFile = JSON.parse(
    readFileSync(join(pluginRoot, PLUGIN_SIGNATURE_PATH), "utf8"),
  );
  if (signatureFile.publisher !== expectedPublisher) {
    throw new Error(
      `${pluginRoot}: publisher ${JSON.stringify(signatureFile.publisher)} is not ${expectedPublisher}`,
    );
  }
  if (typeof signatureFile.signature !== "string" || signatureFile.signature.length === 0) {
    throw new Error(`${pluginRoot}: signature is missing`);
  }
  if (signatureFile.files === null || typeof signatureFile.files !== "object") {
    throw new Error(`${pluginRoot}: signed file map is missing`);
  }
  const actualFiles = collectPluginPayloadDigests(pluginRoot);
  if (JSON.stringify(signatureFile.files) !== JSON.stringify(actualFiles)) {
    throw new Error(`${pluginRoot}: signed file map does not match the plugin payload`);
  }
  const keys = (Array.isArray(publicKey) ? publicKey : [publicKey]).map((value) => {
    const key = value?.type === "public" ? value : createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("plugin publisher key must be Ed25519");
    }
    return key;
  });
  if (keys.length === 0 || keys.length > 16) {
    throw new Error("plugin publisher requires between 1 and 16 trusted keys");
  }
  const verified = keys.some((key) => verifySignature(
    null,
    pluginSignaturePayload(pluginRoot, actualFiles),
    key,
    Buffer.from(signatureFile.signature, "base64"),
  ));
  if (!verified) throw new Error(`${pluginRoot}: Ed25519 signature does not verify`);
  return { publisher: signatureFile.publisher, files: Object.keys(actualFiles).length };
}

export function assertRegularFile(path) {
  if (!statSync(path).isFile()) throw new Error(`expected a regular file: ${path}`);
}
