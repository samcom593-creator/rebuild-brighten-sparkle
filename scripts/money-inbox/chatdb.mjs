// chatdb.mjs — read-only SQL against a TCC-protected sqlite file (chat.db, AddressBook) via the FDA-granted node binary.
// usage: node --experimental-sqlite chatdb.mjs <db> <sql> [paramsJson]   -> JSON rows; blobs as {b64}
import { DatabaseSync } from "node:sqlite";
const [, , dbPath, sql, paramsJson] = process.argv;
const db = new DatabaseSync(dbPath, { readOnly: true });
const statement = db.prepare(sql);
statement.setReadBigInts(true);
const rows = statement.all(...JSON.parse(paramsJson || "[]"));
const out = rows.map((r) => {
  const o = {};
  for (const [k, v] of Object.entries(r))
    o[k] =
      v instanceof Uint8Array
        ? { b64: Buffer.from(v).toString("base64") }
        : typeof v === "bigint"
          ? Number(v)
          : v;
  return o;
});
process.stdout.write(JSON.stringify(out));
