import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const repository = "samcom593-creator/rebuild-brighten-sparkle";
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(process.env.GITHUB_REF, "refs/heads/codex/prepare-task-contracts-20261126");
const token = process.env.GITHUB_TOKEN;
assert(token, "Repository token is required for immutable blob creation.");
const gitHash = content => createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0").update(content).digest("hex");
const originalTypes = await readFile("src/integrations/supabase/types.ts", "utf8");
assert.equal(gitHash(originalTypes), "50daccbb46d743484f026d68cf411077f007b96e");
const addition = [
"      personal_task_create: {",
"        Args: { p_agent_id: string; p_title: string; p_description: string | null; p_due_date: string | null; p_priority: string }",
"        Returns: Json",
"      }",
"      personal_task_identity: { Args: never; Returns: Json }",
"      personal_task_list: { Args: { p_agent_id: string }; Returns: Json }",
"      personal_task_set_completed: {",
"        Args: { p_agent_id: string; p_task_id: string; p_completed: boolean }",
"        Returns: Json",
"      }",
""
].join("\n");
assert.equal(addition.length, 471);
const marker = "      phc_admin_lead_stats:";
assert.equal(originalTypes.split(marker).length - 1, 1);
assert(!originalTypes.includes("      personal_task_identity:"));
const updatedTypes = originalTypes.replace(marker, addition + marker);
assert.equal(gitHash(updatedTypes), "4a50d4f8bf57a55c2d91cb99c7ddb5bed8ba117f");

const contracts = {
  personal_task_create: ["p_agent_id uuid", "p_title text", "p_description text", "p_due_date date", "p_priority text"],
  personal_task_identity: [],
  personal_task_list: ["p_agent_id uuid"],
  personal_task_set_completed: ["p_agent_id uuid", "p_task_id uuid", "p_completed boolean"]
};
const provenance = {
  migration: "20261125120000_personal_task_canonical_self.sql",
  return_type: "jsonb",
  named_output_columns: false,
  source: "Exact authored migration signature, executed in isolated PostgreSQL fixtures; validate against deployed pg_proc after application."
};
const catalogPath = "scripts/data/rpc-catalog.json";
const vocabularyPath = "scripts/data/rpc-column-vocabulary.json";
const catalogSource = await readFile(catalogPath, "utf8");
const vocabularySource = await readFile(vocabularyPath, "utf8");
const catalog = JSON.parse(catalogSource);
const vocabulary = JSON.parse(vocabularySource);
const originalCatalogMetadata = Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith("_")));
const originalVocabularyMetadata = Object.fromEntries(Object.entries(vocabulary).filter(([key]) => key.startsWith("_")));
for (const [name, args] of Object.entries(contracts)) {
  assert(!Object.hasOwn(catalog.functions, name), "Unexpected existing RPC: " + name);
  assert(!Object.hasOwn(vocabulary.uncoverable, name), "Unexpected existing vocabulary: " + name);
  assert(!Object.hasOwn(vocabulary.columns, name), "Unexpected existing named columns: " + name);
  const keys = args.map(arg => arg.split(" ")[0]);
  catalog.functions[name] = [{ all: keys, required: keys, unnamed: false, raw: args.join(", ") }];
  vocabulary.uncoverable[name] = "jsonb";
}
assert.deepEqual(Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith("_"))), originalCatalogMetadata);
assert.deepEqual(Object.fromEntries(Object.entries(vocabulary).filter(([key]) => key.startsWith("_"))), originalVocabularyMetadata);
for (const data of [catalog, vocabulary]) {
  data._declared_migration_contracts ??= {};
  for (const name of Object.keys(contracts)) {
    assert(!Object.hasOwn(data._declared_migration_contracts, name));
    data._declared_migration_contracts[name] = { ...provenance };
  }
}

const files = [
  { path: "src/integrations/supabase/types.ts", source: originalTypes, content: updatedTypes },
  { path: catalogPath, source: catalogSource, content: JSON.stringify(catalog, null, 2) + "\n" },
  { path: vocabularyPath, source: vocabularySource, content: JSON.stringify(vocabulary, null, 2) + "\n" }
];
for (const file of files) {
  const sha = gitHash(file.content);
  const response = await fetch("https://api.github.com/repos/" + repository + "/git/blobs", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    signal: AbortSignal.timeout(60000)
  });
  assert.equal(response.status, 201, "Immutable blob creation failed with HTTP " + response.status);
  const result = await response.json();
  assert.equal(result.sha, sha, "GitHub blob does not match exact source bytes.");
  console.log("TASK_CONTRACT_BLOB=" + JSON.stringify({ path: file.path, mode: "100644", type: "blob", sha, base_sha: gitHash(file.source), bytes: Buffer.byteLength(file.content) }));
}
console.log("Created immutable source objects only; no branch, commit, PR or production reference was changed.");
