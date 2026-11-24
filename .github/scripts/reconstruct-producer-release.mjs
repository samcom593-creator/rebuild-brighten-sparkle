import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "a679d70e0b5ffd82aed3e660da898a2452cff502";
const expectedTree = "c8932ddadf439b870c0ed0b65eea95aa7f04d2fa";
const patchDirectory = fileURLToPath(new URL("../release-patches/producer-workspace-20261124/", import.meta.url));
const releaseDirectory = process.env.RELEASE_WORKTREE;
const git = (args, cwd = process.cwd()) => execFileSync("git", args, {
  cwd, encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
}).trim();

assert.ok(releaseDirectory && process.env.RUNNER_TEMP, "The runner worktree paths are required.");
assert.equal(resolve(releaseDirectory), resolve(process.env.RUNNER_TEMP, "galaxy-producer-release-20261124"));
assert.ok(!existsSync(releaseDirectory), "The release worktree must start empty.");
assert.equal(git(["rev-parse", "refs/remotes/origin/main"]), base, "origin/main moved from the reviewed base.");
assert.equal(git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]), `${base}\trefs/heads/main`, "Remote main moved from the reviewed base.");

const manifest = JSON.parse(readFileSync(resolve(patchDirectory, "manifest.json"), "utf8"));
assert.equal(manifest.base, base);
assert.equal(manifest.expected_tree, expectedTree);
assert.ok(Array.isArray(manifest.files) && manifest.files.length === 15);
assert.deepEqual(readdirSync(patchDirectory).sort(), ["manifest.json", ...manifest.files.map((file) => file.name)].sort());
assert.ok(Array.isArray(manifest.expected_changed_paths) && manifest.expected_changed_paths.length === 119);
assert.ok(manifest.expected_changed_paths.every((path) => typeof path === "string"));
assert.equal(new Set(manifest.expected_changed_paths).size, 119);
const paths = new Set();

for (const [index, file] of manifest.files.entries()) {
  assert.equal(file.name, `${String(index + 1).padStart(3, "0")}.patch`, "Patch order or name changed.");
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 1000000);
  const bytes = readFileSync(resolve(patchDirectory, file.name));
  assert.equal(bytes.length, file.bytes, `${file.name}: byte count changed.`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, `${file.name}: hash changed.`);
  const text = bytes.toString("utf8");
  assert.ok(Buffer.from(text, "utf8").equals(bytes) && !text.includes("\0"), "Patch must be readable UTF-8 text.");
  assert.ok(!/^(?:GIT binary patch|Binary files )/m.test(text), "Binary patch payloads are not allowed.");
  const headers = text.match(/^diff --git .+$/gm) ?? [];
  assert.ok(headers.length > 0, `${file.name}: no file patch found.`);
  for (const header of headers) {
    const match = header.match(/^diff --git a\/([A-Za-z0-9_./-]+) b\/\1$/);
    assert.ok(match, "Renamed or unsupported patch paths are not allowed.");
    const path = match[1];
    assert.ok((/^(?:src|scripts|supabase)\//.test(path) || path === ".github/workflows/deploy-supabase.yml")
      && !path.split("/").includes(".."), "Patch path is outside the approved source areas.");
    assert.ok(!paths.has(path), "A file must not span patch parts.");
    paths.add(path);
  }
}
assert.equal(paths.size, 119, "The approved source file count changed.");
assert.deepEqual([...paths].sort(), [...manifest.expected_changed_paths].sort(), "The source path allowlist changed.");

git(["worktree", "add", "--detach", releaseDirectory, base]);
for (const file of manifest.files) {
  git(["apply", "--index", resolve(patchDirectory, file.name)], releaseDirectory);
}
assert.equal(git(["write-tree"], releaseDirectory), expectedTree, "Reconstructed source does not match the reviewed tree.");
assert.equal(git(["diff", "--name-only"], releaseDirectory), "", "Unstaged changes appeared while reconstructing the source.");
const staged = git(["diff", "--cached", "--name-only"], releaseDirectory).split("\n").sort();
assert.deepEqual(staged, [...paths].sort());
git(["diff", "--cached", "--check"], releaseDirectory);
console.log(`RELEASE_SOURCE_RECONSTRUCTED=${JSON.stringify({ base, tree: expectedTree, files: paths.size })}`);
