import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = join(ROOT, "plugins", "zeroday-hunter", "scripts");

// macOS ships bash 3.2 and BSD sed: no associative arrays, no GNU `sed -i`, no `\|` in basic regexes.
test("zeroday scripts avoid bash 4 and GNU-only idioms", () => {
  for (const name of readdirSync(SCRIPTS).filter((file) => file.endsWith(".sh"))) {
    const source = readFileSync(join(SCRIPTS, name), "utf8");
    assert.doesNotMatch(source, /declare -A|mapfile|readarray|\$\{[A-Za-z_]+(?:,,|\^\^)\}/u, `${name}: bash 4 only`);
    assert.doesNotMatch(source, /\bsed -i\b/u, `${name}: sed -i differs between BSD and GNU`);
    assert.doesNotMatch(source, /sed '[^']*\\\|/u, `${name}: \\| alternation is GNU-only in basic regexes`);
  }
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), "zdh-scripts-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "p.c"), "int parse(char *s) { char b[8]; strcpy(b, s); return helper(1); }\nint main(void) { return parse(\"x\"); }\n");
  writeFileSync(join(root, "src", "q file.c"), "int helper(int x) { return leaf(x) + 1; }\n");
  writeFileSync(join(root, "src", "leaf.c"), "int leaf(int x) { return x; }\n");
  writeFileSync(join(root, "src", "u.c"), "int unrelated(void) { return 0; }\n");
  return root;
}

test("zdh-init.sh fills the campaign fields in place", () => {
  const root = repository();
  try {
    const result = spawnSync("bash", [join(SCRIPTS, "zdh-init.sh"), root, "-Use After Free-", "3"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const campaign = result.stdout.trim();
    assert.match(campaign, /\.zdh\/zdh-\d{8}-use-after-free$/u);
    const yaml = readFileSync(join(campaign, "campaign.yaml"), "utf8");
    assert.match(yaml, /  id: "zdh-\d{8}-use-after-free"/u);
    assert.ok(yaml.includes(`  target_repo: "${root}"`));
    assert.match(yaml, /  bug_class: "-Use After Free-"/u);
    assert.match(yaml, /  max_cost_usd: 3\b/u);
    assert.equal(existsSync(join(campaign, "campaign.yaml.tmp")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("zdh-slice.sh follows callees across files, including paths with spaces", () => {
  const root = repository();
  try {
    const result = spawnSync("bash", [join(SCRIPTS, "zdh-slice.sh"), root, "parse", "2"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const files = [...result.stdout.matchAll(/^===== (.+) \(\d+ lines\) =====$/gmu)].map((match) => match[1]);
    assert.deepEqual(files, ["src/p.c", "src/q file.c", "src/leaf.c"]);
    assert.match(result.stderr, /3 files considered/u);
    const empty = spawnSync("bash", [join(SCRIPTS, "zdh-slice.sh"), root, "nosuchsymbol", "2"], { encoding: "utf8" });
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stderr, /0 files considered/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
