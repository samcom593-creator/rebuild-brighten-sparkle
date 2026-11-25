// One-shot production diagnosis: fixed SELECTs, aggregate-only output, no user impersonation.
// This is not an arbitrary SQL runner. Do not add a command-line query, environment query or workflow input.
import fs from 'node:fs';
import { randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';

const PROJECT = 'xrzweoneiieddzxogewk';
const QUERY_FILES = { audio: 'audio.sql', finances: 'finances.sql', carrier_status: 'carrier-status.sql', production: 'production.sql', definitions: 'definitions.sql' };
const SIGNERS = ['readymode-recording-url', 'training-recording-url', 'lead-recording-url', 'personal-task-create'];
const AUDIO_COUNTS = [
  'dialer_calls','calls_with_provider_recording_reference','calls_linked_to_agent','calls_linked_to_application','calls_linked_to_lead',
  'graded_calls','graded_calls_without_audio_catalog','graded_calls_with_redacted_object','audio_catalog_rows','raw_paths','raw_objects',
  'redacted_objects','redacted_nonempty_objects','redacted_objects_missing','team_visible_audio_rows','team_copy_rows',
  'team_copies_with_audio_object','team_copies_privacy_blocked','team_visible_without_team_audio','library_eligible_before_role_and_limit',
  'library_eligible_with_audio_object','training_rows','training_published','training_published_without_path',
  'training_published_privacy_blocked','training_catalog_eligible_before_role','training_eligible_with_object',
  'training_eligible_missing_object','training_eligible_nonempty_object','training_eligible_audio_mime','training_eligible_transcript_not_array',
  'readymode_bucket_objects','training_bucket_objects','call_recordings_bucket_objects',
];
const AUDIO_BOOLEANS = ['readymode_bucket_private','training_bucket_private','call_recordings_bucket_private',
  'authenticated_call_audio_rpc','anonymous_call_audio_rpc','authenticated_training_catalog_rpc','anonymous_training_catalog_rpc'];
const LEDGER_STATUSES = ['pending','paid','clawed_back','voided','other'];
const RATE_SOURCES = ['override','contract','carrier_default','schedule','carrier_schedule','other'];
const CARRIERS = ['Ethos','Chubb','Combined','other'];
const CHARGEBACK_SOURCES = ['comp_ledger','debt_outstanding','other'];
const POLICY_STATUSES = [
  'premium_paying','renewal_premium_processing','pending_initial_premium','pending_death_claim','grace_period','late_offer_period',
  'lapse_pending','lapsepending','lapsed','cancelled','canceled','terminated','free_look_surrendered','not_taken_initial_premium_failed',
  'unissued_initial_premium_failed','invalid_application','declined','disqualified_instant_no_reroute','policy_unissued','withdrawn',
  'not_taken','nottaken','abandoned','closed_administrative','closed_external_trustage','in_force','inforce','active','paid',
  'issued_and_paid','issued_paid','issued','issued_not_paid','approved','approved_instant','approved_not_issued','pending','in_review',
  'underwriting','submitted','submitted_for_future_issuance','completed','rerouted_trustage','policy_activated_external_trustage',
  'started','quote','unknown',
];

const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid aggregate shape');
  return value;
};
const number = value => {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)))) throw new Error('invalid aggregate number');
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) throw new Error('invalid aggregate number');
  return n;
};
const count = value => {
  const n = number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('invalid aggregate count');
  return n;
};
const boolean = value => { if (typeof value !== 'boolean') throw new Error('invalid aggregate boolean'); return value; };
const enumeration = (value, allowed) => { if (!allowed.includes(value)) throw new Error('invalid aggregate category'); return value; };
const array = value => { if (!Array.isArray(value) || value.length > 100) throw new Error('invalid aggregate array'); return value; };
const date = value => { if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error('invalid aggregate date'); return value; };

function sanitize(name, value) {
  if (name === 'audio') {
    const row = object(value);
    return Object.fromEntries([...AUDIO_COUNTS.map(key => [key, count(row[key])]), ...AUDIO_BOOLEANS.map(key => [key, boolean(row[key])])]);
  }
  if (name === 'finances') {
    const row = object(value);
    const upstream = object(row.agentlink);
    return {
      commission_ledger: array(row.commission_ledger).map(value => {
        const r = object(value);
        return { status: enumeration(r.status, LEDGER_STATUSES), rate_source: enumeration(r.rate_source, RATE_SOURCES),
          rows: count(r.rows), dated_paid_rows: count(r.dated_paid_rows), amount: number(r.amount), dated_paid_amount: number(r.dated_paid_amount) };
      }),
      agentlink: { ...Object.fromEntries(['rows','rows_with_paid_date','rows_with_positive_paid_amount','dated_paid_rows'].map(key => [key,count(upstream[key])])),
        dated_paid_amount: number(upstream.dated_paid_amount), latest_statement: date(upstream.latest_statement) },
      carrier_chargebacks: array(row.carrier_chargebacks).map(value => {
        const r = object(value);
        return { carrier: enumeration(r.carrier, CARRIERS), source: enumeration(r.source, CHARGEBACK_SOURCES), rows: count(r.rows),
          amount: number(r.amount), unassigned_rows: count(r.unassigned_rows), unassigned_amount: number(r.unassigned_amount) };
      }),
    };
  }
  if (name === 'carrier_status') return array(value).map(value => {
    const r = object(value);
    return { status: enumeration(r.status, POLICY_STATUSES), rows: count(r.rows), unassigned_rows: count(r.unassigned_rows), linked_deal_rows: count(r.linked_deal_rows) };
  });
  if (name === 'production') {
    const row = object(value);
    const label = value => {
      if (value !== null && (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9 _./&-]*$/.test(value))) throw new Error('invalid status label');
      return value;
    };
    const groups = value => array(value).map(value => {
      const r = object(value);
      return { carrier: label(r.carrier), status_raw: label(r.status_raw), status_pre: label(r.status_pre), bucket: label(r.bucket),
        rows: count(r.rows), site_linked: count(r.site_linked), unassigned: count(r.unassigned), oldest: date(r.oldest), newest: date(r.newest) };
    });
    return { carrier_book: groups(row.carrier_book), owner_carrier_book: groups(row.owner_carrier_book),
      ambiguous_site_links: count(row.ambiguous_site_links), future_production_rows: count(row.future_production_rows),
      current_month_native_rows: count(row.current_month_native_rows), owner_canonical_records: count(row.owner_canonical_records),
      metric_snapshots_with_placement: count(row.metric_snapshots_with_placement) };
  }
  if (name === 'definitions') {
    const row = object(value);
    const names = ['producer_profile_detail','scoped_production_projection_uncached','agent_carrier_book','home_conversion_people_range'];
    return Object.fromEntries(names.map(name => {
      const value = row[name];
      if (value !== null && (typeof value !== 'string' || value.length > 200000 || !value.startsWith('CREATE OR REPLACE FUNCTION public.'))) throw new Error('invalid function definition');
      return [name,value];
    }));
  }
  throw new Error('unregistered aggregate');
}

function fixedQuery(filename) {
  const sql = fs.readFileSync(new URL(`./operational-read/${filename}`, import.meta.url), 'utf8');
  const code = sql.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''").trim();
  if (!/^(select|with)\b/i.test(code) || /;|\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|set)\b/i.test(code)) throw new Error('query is not a fixed select');
  return sql;
}

async function queryRows(query) {
  const managementToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const botToken = process.env.APEX_BOT_TOKEN?.trim();
  if (managementToken) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, read_only: true }), signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return { rows: await response.json(), provider: 'management-read-only' };
    // The prior read-only recording diagnostic proved this existing endpoint and repository credential.
    // Only credential rejection falls back; SQL errors/timeouts are not repeated through another route.
    if (![401,403].includes(response.status) || !botToken) throw new Error('database query unavailable');
  }
  if (!botToken) throw new Error('database credential unavailable');
  const response = await fetch(`https://${PROJECT}.supabase.co/functions/v1/bot-sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('database query unavailable');
  const body = await response.json();
  if (body?.ok !== true || !Array.isArray(body.rows)) throw new Error('invalid aggregate response');
  return { rows: body.rows, provider: 'bot-sql-fixed-select' };
}

async function signerConfiguration() {
  const token = (process.env.SUPABASE_FUNCTIONS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN)?.trim();
  if (!token) throw new Error('functions credential unavailable');
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('function metadata unavailable');
  const list = await response.json();
  if (!Array.isArray(list)) throw new Error('invalid function metadata');
  return { data: SIGNERS.map(name => {
    const f = list.find(f => f?.slug === name || f?.name === name);
    return { name, registered: !!f, active: !!f && f.status === 'ACTIVE',
      verify_jwt: typeof f?.verify_jwt === 'boolean' ? f.verify_jwt : null,
      version: f && Number.isSafeInteger(f.version) && f.version >= 0 ? f.version : null };
  }) };
}

async function main() {
  const queries = Object.fromEntries(Object.entries(QUERY_FILES).map(([name,file]) => [name,fixedQuery(file)]));
  if (process.argv.length === 3 && process.argv[2] === '--validate') {
    console.log('Fixed operational SELECT files validated; no production request made.');
    return;
  }
  if (process.argv.length !== 2) throw new Error('unsupported diagnostic arguments');
  const tasks = [...Object.entries(queries).map(([name,query]) => [name, async () => {
    const { rows, provider } = await queryRows(query);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('invalid aggregate response');
    return { provider, data: sanitize(name,object(rows[0])[name]) };
  }]), ['signer_configuration', signerConfiguration]];
  const results = await Promise.allSettled(tasks.map(async ([name,run]) => ({ name, value: await run() })));
  const output = { checked_at: new Date().toISOString(), sections: {} };
  results.forEach((result,index) => {
    const name = tasks[index][0];
    if (result.status === 'fulfilled') output.sections[name] = { ok: true, ...result.value.value };
    else { output.sections[name] = { ok: false, reason: 'Read-only diagnostic unavailable or invalid aggregate response.' }; process.exitCode = 1; }
  });
  // This repository is public. Only ciphertext may enter Actions logs.
  // The private recipient key stays in the requesting workspace and is never uploaded.
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm',key,iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(output),'utf8'),cipher.final()]);
  const publicKey = fs.readFileSync(new URL('./operational-read/public-key.pem',import.meta.url));
  const envelope = { v: 1, alg: 'RSA-OAEP-SHA256+A256GCM',
    key: publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
  console.log(`OPERATIONAL_READ_CHECK_ENCRYPTED=${Buffer.from(JSON.stringify(envelope)).toString('base64')}`);
}

main().catch(() => { console.error('::error::Read-only operational diagnostic could not complete. No database or deployment changes were attempted.'); process.exitCode = 1; });
