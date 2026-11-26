#!/usr/bin/env node
// Fixed metadata-only readback for two recruiting-link generators.
// No function bodies, identity/application/business rows, auth claims, private
// keys, or application RPC results are requested or logged.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const CONTRACTS = [
  {
    "name": "my_recruiting_link",
    "signature": "public.my_recruiting_link()",
    "source": "supabase/migrations/20260826023000_free_leads_qualification.sql",
    "oldLiteral": "'https://apex-financial.org/apply?ref='",
    "newLiteral": "'https://galaxyfinancial.org/apply?ref='"
  },
  {
    "name": "my_referral_status",
    "signature": "public.my_referral_status()",
    "source": "supabase/migrations/20261112000270_pkg2_referral_gate_live_production.sql",
    "oldLiteral": "'https://apex-financial.org/r/'",
    "newLiteral": "'https://galaxyfinancial.org/r/'"
  }
];
const QUERY_ENDPOINT = "https://api.supabase.com/v1/projects/xrzweoneiieddzxogewk/database/query";
const SQL = String.raw`-- Exactly two function contracts and one migration receipt; no application execution.
with contracts(name,signature) as (values
  ('my_recruiting_link','public.my_recruiting_link()'),
  ('my_referral_status','public.my_referral_status()')
)
select jsonb_build_object(
  'application_functions_executed',false,
  'business_rows_read',false,
  'auth_claims_changed',false,
  'functions',(select jsonb_object_agg(c.name,jsonb_build_object(
    'signature',c.signature,'present',p.oid is not null,
    'raw_prosrc_md5',md5(p.prosrc),
    'normalized_prosrc_md5',md5(btrim(p.prosrc,E' \t\n\r\f' || chr(11))),
    'apex_origin_count',coalesce((length(p.prosrc)-length(replace(p.prosrc,'https://apex-financial.org/','')))/length('https://apex-financial.org/'),0),
    'galaxy_origin_count',coalesce((length(p.prosrc)-length(replace(p.prosrc,'https://galaxyfinancial.org/','')))/length('https://galaxyfinancial.org/'),0),
    'security_definer',coalesce(p.prosecdef,false),
    'stable',coalesce(p.provolatile='s',false),
    'search_path_public_only',coalesce(p.proconfig=array['search_path=public']::text[],false),
    'returns_jsonb',coalesce(p.prorettype='jsonb'::regtype,false),
    'authenticated_execute',case when p.oid is not null then has_function_privilege('authenticated',p.oid,'EXECUTE') else false end,
    'anon_execute',case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') else false end,
    'public_execute',case when p.oid is not null then exists (
      select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE'
    ) else false end
  )) from contracts c left join pg_catalog.pg_proc p on p.oid=to_regprocedure(c.signature)),
  'normalization_controls',jsonb_build_object(
    'ascii_trim_md5',md5(btrim(E' \t\n\r\f' || chr(11) || E'a b\nc' || chr(11) || E'\f\r\n\t ',E' \t\n\r\f' || chr(11))),
    'nonbreaking_space_md5',md5(btrim(chr(160) || 'abc' || chr(160),E' \t\n\r\f' || chr(11)))
  ),
  'migration',jsonb_build_object('version','20261125140000','recorded',exists(
    select 1 from supabase_migrations.schema_migrations where version::text='20261125140000'
  ))
) as recruiting_link_metadata`;
const md5 = value => createHash("md5").update(value, "utf8").digest("hex");
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
class ReadbackUnavailable extends Error {}

function ensure(condition,message){if(!condition)throw new Error(message);}

function trimSQL(value){return value.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g,"");}

function occurrences(value,needle){return (value.length-value.split(needle).join("").length)/needle.length;}

function extractBody(source,name){
 const pattern=new RegExp("create\\s+(?:or\\s+replace\\s+)?function\\s+public\\."+name+"\\s*\\(\\s*\\)","ig");
 const matches=[...source.matchAll(pattern)];ensure(matches.length===1,"Historical function is missing or ambiguous: "+name);
 const rest=source.slice(matches[0].index),as=rest.match(/\bas\s+(\$[A-Za-z_0-9]*\$)/i);ensure(as,"Historical function body is missing: "+name);
 const start=as.index+as[0].length,end=rest.indexOf(as[1],start);ensure(end>=start,"Historical function body is unterminated: "+name);
 return rest.slice(start,end);
}

function object(value){ensure(value!==null&&typeof value==="object"&&!Array.isArray(value),"Invalid metadata object");return value;}

function boolean(value){ensure(typeof value==="boolean","Invalid metadata boolean");return value;}

function fingerprint(value,nullable=false){ensure(nullable&&value===null||typeof value==="string"&&/^[a-f0-9]{32}$/.test(value),"Invalid metadata fingerprint");return value;}

function count(value){ensure(Number.isSafeInteger(value)&&value>=0&&value<=1000,"Invalid metadata count");return value;}

function sanitize(value,contracts){
 const row=object(value);
 for(const key of ["application_functions_executed","business_rows_read","auth_claims_changed"])ensure(row[key]===false,"Metadata read boundary was not preserved");
 const incoming=object(row.functions),names=contracts.map(x=>x.name);
 ensure(Object.keys(incoming).length===2&&Object.keys(incoming).every(x=>names.includes(x)),"Unexpected function metadata set");
 const functions=Object.fromEntries(contracts.map(contract=>{
  const f=object(incoming[contract.name]);ensure(f.signature===contract.signature,"Unexpected function signature");
  const present=boolean(f.present);
  const result={signature:contract.signature,present,raw_prosrc_md5:fingerprint(f.raw_prosrc_md5,!present),normalized_prosrc_md5:fingerprint(f.normalized_prosrc_md5,!present),
   apex_origin_count:count(f.apex_origin_count),galaxy_origin_count:count(f.galaxy_origin_count)};
  for(const key of ["security_definer","stable","search_path_public_only","returns_jsonb","authenticated_execute","anon_execute","public_execute"])result[key]=boolean(f[key]);
  if(!present)ensure(result.raw_prosrc_md5===null&&result.normalized_prosrc_md5===null&&result.apex_origin_count===0&&result.galaxy_origin_count===0&&
   !["security_definer","stable","search_path_public_only","returns_jsonb","authenticated_execute","anon_execute","public_execute"].some(key=>result[key]),"Missing function has metadata");
  return[contract.name,result];
 }));
 const controls=object(row.normalization_controls);
 const normalization_controls={ascii_trim_md5:fingerprint(controls.ascii_trim_md5),nonbreaking_space_md5:fingerprint(controls.nonbreaking_space_md5)};
 const migration=object(row.migration);ensure(migration.version==="20261125140000","Unexpected migration metadata");
 return {application_functions_executed:false,business_rows_read:false,auth_claims_changed:false,functions,normalization_controls,migration:{version:migration.version,recorded:boolean(migration.recorded)}};
}

function fixedSelect(sql){
 const code=sql.replace(/--[^\n]*/g,"").replace(/'(?:[^']|'')*'/g,"''").trim();
 ensure(/^(select|with)\b/i.test(code)&&!/[;]|\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|set)\b/i.test(code),"Fixed metadata query is not SELECT-only");
 return sql;
}

function expectedFingerprints() {
  return Object.fromEntries(CONTRACTS.map(contract => {
    const body = extractBody(read(contract.source), contract.name);
    ensure(occurrences(body, contract.oldLiteral) === 1 && occurrences(body, contract.newLiteral) === 0,
      "Historical link literal is missing or ambiguous: " + contract.name);
    const expectedBody = body.replace(contract.oldLiteral, contract.newLiteral);
    return [contract.name, md5(trimSQL(expectedBody))];
  }));
}
function normalizationControls() {
  // SQL btrim and JS trimSQL remove exactly these six ASCII characters:
  // space, tab, LF, CR, form feed, vertical tab. NBSP is deliberately retained.
  const edges = " \t\n\r\f\v";
  return {
    ascii_trim_md5: md5(trimSQL(edges + "a b\nc" + edges)),
    nonbreaking_space_md5: md5(trimSQL("\u00a0abc\u00a0")),
  };
}
function verify(value, expected) {
  ensure(value.migration.recorded, "Migration 140000 is not recorded");
  const controls = normalizationControls();
  for (const key of Object.keys(controls)) ensure(value.normalization_controls[key] === controls[key],
    "SQL/JavaScript normalization differs: " + key);
  for (const contract of CONTRACTS) {
    const row = value.functions[contract.name];
    ensure(row.present, "Required function is missing: " + contract.name);
    ensure(row.normalized_prosrc_md5 === expected[contract.name], "Function fingerprint differs from the exact origin replacement: " + contract.name);
    ensure(row.apex_origin_count === 0 && row.galaxy_origin_count === 1, "Function origin count differs: " + contract.name);
    for (const key of ["security_definer","stable","search_path_public_only","returns_jsonb","authenticated_execute"]) {
      ensure(row[key], "Function contract differs: " + contract.name + "." + key);
    }
    ensure(!row.anon_execute && !row.public_execute, "Function execution privileges widened: " + contract.name);
  }
}
async function readMetadata() {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new ReadbackUnavailable("Management read credential is unavailable");
  let response;
  try {
    response = await fetch(QUERY_ENDPOINT, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: fixedSelect(SQL), read_only: true }),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new ReadbackUnavailable("Read-only management request could not complete");
  }
  // Never log a raw response/error body: only the strictly validated projection.
  if (!response.ok) throw new ReadbackUnavailable("Read-only management request returned HTTP " + response.status);
  let data;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks = []; let length = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 16384) { await reader.cancel(); throw new Error("Oversized body"); }
      chunks.push(part.value);
    }
    data = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
  } catch {
    throw new ReadbackUnavailable("Read-only metadata response is unavailable or malformed");
  }
  ensure(Array.isArray(data) && data.length === 1, "Unexpected metadata result shape");
  const row = object(data[0]);
  ensure(Object.keys(row).length === 1 && Object.hasOwn(row, "recruiting_link_metadata"), "Unexpected metadata result column");
  return sanitize(row.recruiting_link_metadata, CONTRACTS);
}
function selftest() {
  let checks = 0;
  const check = (condition, message) => { ensure(condition, message); checks++; };
  const rejects = (fn, message) => { let rejected = false; try { fn(); } catch { rejected = true; } check(rejected, message); };
  check(md5("abc") === "900150983cd24fb0d6963f7d28e17f72", "MD5 control failed");
  const edges = " \t\n\r\f\v";
  check(trimSQL(edges + "a b\nc" + edges) === "a b\nc", "ASCII trim control failed");
  check(trimSQL("\u00a0abc\u00a0") === "\u00a0abc\u00a0", "NBSP must remain intact");
  check(fixedSelect(SQL) === SQL, "Fixed query validation failed");
  rejects(() => fixedSelect("select 1; delete from agents"), "Mutation-shaped query was accepted");
  const expected = expectedFingerprints();
  check(Object.values(expected).every(hash => /^[a-f0-9]{32}$/.test(hash)), "Historical source fingerprint failed");
  const fixture = {"application_functions_executed":false,"business_rows_read":false,"auth_claims_changed":false,"functions":{"my_recruiting_link":{"signature":"public.my_recruiting_link()","present":true,"raw_prosrc_md5":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","normalized_prosrc_md5":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","apex_origin_count":0,"galaxy_origin_count":1,"security_definer":true,"stable":true,"search_path_public_only":true,"returns_jsonb":true,"authenticated_execute":true,"anon_execute":false,"public_execute":false},"my_referral_status":{"signature":"public.my_referral_status()","present":true,"raw_prosrc_md5":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","normalized_prosrc_md5":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","apex_origin_count":0,"galaxy_origin_count":1,"security_definer":true,"stable":true,"search_path_public_only":true,"returns_jsonb":true,"authenticated_execute":true,"anon_execute":false,"public_execute":false}},"normalization_controls":{"ascii_trim_md5":"cccccccccccccccccccccccccccccccc","nonbreaking_space_md5":"dddddddddddddddddddddddddddddddd"},"migration":{"version":"20261125140000","recorded":true}};
  fixture.normalization_controls = normalizationControls();
  for (const contract of CONTRACTS) fixture.functions[contract.name].normalized_prosrc_md5 = expected[contract.name];
  check(JSON.stringify(sanitize(fixture, CONTRACTS)) === JSON.stringify(fixture), "Valid metadata changed unexpectedly");
  verify(fixture, expected); check(true, "Valid metadata verification failed");
  const mutations = [
    value => value.application_functions_executed = true,
    value => value.business_rows_read = true,
    value => value.auth_claims_changed = true,
    value => delete value.functions.my_referral_status,
    value => value.functions.unexpected = value.functions.my_referral_status,
    value => value.functions.my_recruiting_link.signature = "public.other()",
    value => value.functions.my_recruiting_link.raw_prosrc_md5 = "invalid",
    value => value.functions.my_recruiting_link.normalized_prosrc_md5 = null,
    value => value.functions.my_recruiting_link.apex_origin_count = -1,
    value => value.functions.my_recruiting_link.galaxy_origin_count = 1.5,
    value => value.functions.my_recruiting_link.authenticated_execute = "true",
    value => value.functions.my_recruiting_link.present = false,
    value => value.migration.version = "other",
    value => value.migration.recorded = "true",
    value => value.normalization_controls.ascii_trim_md5 = "invalid",
  ];
  for (const mutate of mutations) {
    const value = structuredClone(fixture); mutate(value);
    rejects(() => sanitize(value, CONTRACTS), "Malformed metadata was accepted");
  }
  for (const mutate of [
    value => value.migration.recorded = false,
    value => value.functions.my_recruiting_link.normalized_prosrc_md5 = "0".repeat(32),
    value => value.functions.my_recruiting_link.apex_origin_count = 1,
    value => value.functions.my_recruiting_link.galaxy_origin_count = 0,
    value => value.functions.my_referral_status.public_execute = true,
    value => value.functions.my_referral_status.search_path_public_only = false,
    value => value.normalization_controls.nonbreaking_space_md5 = "0".repeat(32),
  ]) {
    const value = structuredClone(fixture); mutate(value);
    rejects(() => verify(sanitize(value, CONTRACTS), expected), "Incorrect live contract was accepted");
  }
  const extra = structuredClone(fixture);
  extra.private_data = "MUST_NOT_ESCAPE";
  extra.functions.my_recruiting_link.private_data = "MUST_NOT_ESCAPE";
  check(!JSON.stringify(sanitize(extra, CONTRACTS)).includes("MUST_NOT_ESCAPE"), "Unrecognized metadata escaped");
  console.log("Recruiting link schema selftests passed: " + checks);
  console.log("EXPECTED_NORMALIZED_PROSRC_MD5=" + JSON.stringify(expected));
}
async function main() {
  const releaseSha = process.env.RELEASE_SHA;
  ensure(/^[a-f0-9]{40}$/.test(releaseSha ?? ""), "The exact release parent SHA is required");
  const expected = expectedFingerprints();
  const value = await readMetadata();
  console.log("RECRUITING_LINK_SCHEMA_READBACK=" + JSON.stringify({
    checked_at: new Date().toISOString(), release_sha: releaseSha,
    expected_normalized_prosrc_md5: expected, metadata: value,
  }));
  verify(value, expected);
  console.log("RECRUITING_LINK_SCHEMA_VERIFIED " + releaseSha);
}
async function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--selftest") selftest();
  else { ensure(args.length === 0, "Unsupported schema readback arguments"); await main(); }
}
run().catch(error => {
  console.error("RECRUITING_LINK_SCHEMA_" + (error instanceof ReadbackUnavailable ? "UNAVAILABLE" : "FAILED") + ": " + error.message);
  process.exitCode = error instanceof ReadbackUnavailable ? 3 : 1;
});
