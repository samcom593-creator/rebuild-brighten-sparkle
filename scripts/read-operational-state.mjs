// One-shot production diagnosis: fixed SELECTs, aggregate-only output, no user impersonation.
// This is not an arbitrary SQL runner. Do not add a command-line query, environment query or workflow input.
import fs from 'node:fs';
import { randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';

const PROJECT = 'xrzweoneiieddzxogewk';
const QUERY_FILES = { audio: 'audio.sql', finances: 'finances.sql', carrier_status: 'carrier-status.sql', production: 'production.sql', definitions: 'definitions.sql', release: 'release.sql', lead_performance: 'lead-performance.sql', task_identity: 'task-identity.sql' };
const SIGNERS = ['readymode-recording-url', 'training-recording-url', 'lead-recording-url', 'personal-task-create'];
const AUDIO_COUNTS = [
  'dialer_calls','calls_with_provider_recording_reference','calls_linked_to_agent','calls_linked_to_application','calls_linked_to_lead',
  'graded_calls','graded_calls_without_audio_catalog','graded_calls_with_redacted_object','audio_catalog_rows','raw_paths','raw_objects',
  'redacted_objects','redacted_nonempty_objects','redacted_objects_missing','team_visible_audio_rows','team_copy_rows',
  'team_copies_with_audio_object','team_visible_without_team_audio','library_candidates_before_privacy',
  'library_candidates_with_audio_object','training_rows','training_published','training_published_without_path',
  'training_published_with_path','training_published_with_object',
  'training_published_missing_object','training_published_nonempty_object','training_published_audio_mime','training_published_transcript_not_array',
  'readymode_bucket_objects','training_bucket_objects','call_recordings_bucket_objects',
];
const AUDIO_BOOLEANS = ['privacy_filter_evaluated','readymode_bucket_private','training_bucket_private','call_recordings_bucket_private',
  'authenticated_call_audio_rpc','anonymous_call_audio_rpc','authenticated_training_catalog_rpc','anonymous_training_catalog_rpc'];
const LEDGER_STATUSES = ['pending','paid','clawed_back','voided','other'];
const RATE_SOURCES = ['override','contract','carrier_default','schedule','carrier_schedule','other'];
const CARRIERS = ['Ethos','Chubb','Combined','other'];
const CHARGEBACK_SOURCES = ['comp_ledger','debt_outstanding','other'];
const RELEASE_BASE_SHA = 'd0302b334f7264ed214f8aaca5d174ef3fc3fc63';
const RELEASE_VERSIONS = ['20261125100000','20261125101000'];
const COHORT_CONTRACT_FLAGS = ['present','jsonb_return','argument_names_exact','one_default_argument','security_definer','stable',
  'public_search_path','authenticated_execute','anon_execute','public_execute','auth_guard','blocked_user_guard',
  'suspended_user_guard','canonical_self_guard','exact_site_link','no_policy_number_inference','future_timestamp_guard','response_identity'];
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
  if (name === 'task_identity') {
    const row = object(value);
    for (const key of ['application_functions_executed','identity_rows_read','task_rows_read','auth_claims_changed']) {
      if (row[key] !== false) throw new Error('invalid task metadata boundary');
    }
    const metadataText = (value, max = 100000, nullable = false) => {
      if (nullable && value === null) return null;
      if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) throw new Error('invalid task catalog text');
      return value;
    };
    const identifier = value => {
      if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) throw new Error('invalid task catalog identifier');
      return value;
    };
    const flags = (value, names) => Object.fromEntries(names.map(key => [key,boolean(value[key])]));
    const config = value => value === null ? null : array(value).map(value => {
      if (typeof value !== 'string' || value.length > 500 || !/^(search_path|statement_timeout|lock_timeout|work_mem|jit|row_security|plan_cache_mode)=[A-Za-z0-9_ ,.$"-]+$/.test(value)) throw new Error('invalid task function configuration');
      return value;
    });
    const contracts = {
      current_agent_id:'public.current_agent_id()',
      fn_user_login_blocked:'public.fn_user_login_blocked(uuid)',
      fn_user_is_suspended:'public.fn_user_is_suspended(uuid)',
      fn_agent_is_suspended:'public.fn_agent_is_suspended(uuid)',
      set_agent_active:'public.set_agent_active(uuid[],boolean)',
      personal_task_identity:'public.personal_task_identity()',
      personal_task_list:'public.personal_task_list(uuid)',
      personal_task_set_completed:'public.personal_task_set_completed(uuid,uuid,boolean)',
      personal_task_create:'public.personal_task_create(uuid,text,text,date,text)',
    };
    const source = object(row.functions);
    if (Object.keys(source).length !== Object.keys(contracts).length || Object.keys(source).some(key => !Object.hasOwn(contracts,key))) throw new Error('unexpected task function set');
    const functions = Object.fromEntries(Object.entries(contracts).map(([key,signature]) => {
      const f = object(source[key]);
      if (f.signature !== signature) throw new Error('unexpected task function signature');
      const present = boolean(f.present);
      const definition = metadataText(f.definition,100000,true);
      const returnType = metadataText(f.return_type,2000,true);
      const proconfig = config(f.proconfig);
      const access = flags(f,['security_definer','authenticated_execute','anon_execute','public_execute']);
      const volatility = present ? enumeration(f.volatility,['i','s','v']) : null;
      if (present && (!definition?.startsWith(`CREATE OR REPLACE FUNCTION public.${key}(`) || !returnType)) throw new Error('invalid task function definition');
      if (!present && (definition !== null || returnType !== null || proconfig !== null || f.volatility !== null || Object.values(access).some(Boolean))) throw new Error('missing task function has metadata');
      return [key,{ signature,present,definition,return_type:returnType,proconfig,...access,volatility }];
    }));
    const tableNames = ['agents','agent_tasks'];
    const tables = array(row.tables).map(value => {
      const t = object(value);
      const name = enumeration(t.name,tableNames);
      const tableFlags = flags(t,['present','rls_enabled','rls_forced','authenticated_select','authenticated_insert','authenticated_update','authenticated_delete']);
      const kind = tableFlags.present ? enumeration(t.kind,['r','p','v','m','f']) : null;
      if (!tableFlags.present && (t.kind !== null || Object.values(tableFlags).some(Boolean))) throw new Error('missing task relation has metadata');
      return { name,kind,...tableFlags };
    });
    if (tables.length !== 2 || new Set(tables.map(t => t.name)).size !== 2) throw new Error('invalid task relation set');
    const identityColumns = ['id','user_id','canonical_agent_id','status','is_inactive','is_deactivated'];
    const agentsUpdateColumns = array(row.agents_update_columns).map(value => {
      const c = object(value);
      const name = enumeration(c.name,identityColumns);
      const columnFlags = flags(c,['present','authenticated_update']);
      if (!columnFlags.present && columnFlags.authenticated_update) throw new Error('missing identity column has privileges');
      return { name,...columnFlags };
    });
    if (agentsUpdateColumns.length !== identityColumns.length || new Set(agentsUpdateColumns.map(c => c.name)).size !== identityColumns.length) throw new Error('invalid identity column set');
    const policies = array(row.policies).map(value => {
      const p = object(value);
      return { table:enumeration(p.table,tableNames),name:metadataText(p.name,200),
        permissive:enumeration(p.permissive,['PERMISSIVE','RESTRICTIVE']),roles:array(p.roles).map(identifier),
        command:enumeration(p.command,['ALL','SELECT','INSERT','UPDATE','DELETE']),
        using_expression:metadataText(p.using_expression,30000,true),check_expression:metadataText(p.check_expression,30000,true) };
    });
    const triggers = array(row.agents_before_write_triggers).map(value => {
      const t = object(value);
      const name = identifier(t.name), functionSchema = identifier(t.function_schema), functionName = identifier(t.function_name);
      const triggerFlags = flags(t,['internal','before_insert','before_update','security_definer']);
      const definition = metadataText(t.definition,30000), functionDefinition = metadataText(t.function_definition,200000);
      if (!triggerFlags.before_insert && !triggerFlags.before_update || !/^CREATE (CONSTRAINT )?TRIGGER\s/.test(definition)
        || !functionDefinition.startsWith(`CREATE OR REPLACE FUNCTION ${functionSchema}.${functionName}(`)) throw new Error('invalid agent guard definition');
      return { name,enabled:enumeration(t.enabled,['O','D','R','A']),...triggerFlags,definition,
        function_schema:functionSchema,function_name:functionName,function_definition:functionDefinition,
        volatility:enumeration(t.volatility,['i','s','v']),proconfig:config(t.proconfig) };
    });
    const taskColumns = array(row.task_columns).map(value => {
      const c = object(value);
      return { name:identifier(c.name),type:metadataText(c.type,500),not_null:boolean(c.not_null),
        default_expression:metadataText(c.default_expression,30000,true) };
    });
    const taskIndexes = array(row.task_indexes).map(value => {
      const i = object(value), name = identifier(i.name), definition = metadataText(i.definition,20000);
      if (!definition.startsWith(`CREATE INDEX ${name} ON public.agent_tasks `) && !definition.startsWith(`CREATE UNIQUE INDEX ${name} ON public.agent_tasks `)) throw new Error('invalid task index definition');
      return { name,definition };
    });
    const migration = object(row.migration);
    if (migration.version !== '20261125120000') throw new Error('unexpected task migration');
    return { application_functions_executed:false,identity_rows_read:false,task_rows_read:false,auth_claims_changed:false,
      functions,tables,agents_update_columns:agentsUpdateColumns,policies,agents_before_write_triggers:triggers,
      task_columns:taskColumns,task_indexes:taskIndexes,migration:{version:migration.version,recorded:boolean(migration.recorded)} };
  }
  if (name === 'lead_performance') {
    const row = object(value);
    if (row.application_functions_executed !== false || row.lead_rows_read !== false || row.auth_claims_changed !== false) throw new Error('invalid lead metadata boundary');
    const contracts = {
      lead_pool_counts: 'public.lead_pool_counts(text,jsonb)',
      lead_pool_candidates: 'public.lead_pool_candidates(text,jsonb)',
      lead_pool_filter_matches: 'public.lead_pool_filter_matches(text,integer,text,integer,jsonb,jsonb)',
      lead_pool_candidates_for_phones: 'public.lead_pool_candidates_for_phones(text,jsonb,text[])',
      lead_pool_static_filter_matches: 'public.lead_pool_static_filter_matches(text,integer,text,integer,jsonb)',
      lead_pool_preview_candidates: 'public.lead_pool_preview_candidates(text,jsonb)',
      lead_pool_assign: 'public.lead_pool_assign(text,jsonb,integer,uuid,text,text)',
      sellable_pool: 'public.sellable_pool(text,jsonb)',
    };
    const source = object(row.functions);
    if (Object.keys(source).length !== Object.keys(contracts).length || Object.keys(source).some(key => !Object.hasOwn(contracts,key))) throw new Error('unexpected lead function set');
    const functions = Object.fromEntries(Object.entries(contracts).map(([key, signature]) => {
      const f = object(source[key]);
      if (f.signature !== signature) throw new Error('unexpected lead function signature');
      const present = boolean(f.present);
      if (present) {
        if (typeof f.definition !== 'string' || f.definition.length > 100000 || !f.definition.startsWith(`CREATE OR REPLACE FUNCTION public.${key}(`) || f.definition.includes('\u0000')) throw new Error('invalid lead function definition');
      } else if (f.definition !== null || f.proconfig !== null) throw new Error('missing lead function has metadata');
      const proconfig = f.proconfig === null ? null : array(f.proconfig).map(value => {
        if (typeof value !== 'string' || value.length > 500 || !/^(search_path|statement_timeout|lock_timeout|work_mem|jit)=[A-Za-z0-9_ ,.$"-]+$/.test(value)) throw new Error('invalid lead function configuration');
        return value;
      });
      const flags = Object.fromEntries(['security_definer','authenticated_execute','anon_execute','public_execute'].map(key => [key,boolean(f[key])]));
      const volatility = present ? enumeration(f.volatility,['i','s','v']) : null;
      if (!present && (f.volatility !== null || Object.values(flags).some(Boolean))) throw new Error('missing lead function has privileges');
      return [key, { signature, present, definition: f.definition, proconfig, ...flags, volatility }];
    }));
    const view = object(row.candidate_view);
    if (view.name !== 'public.v_lead_pool_candidate_base') throw new Error('unexpected lead view');
    const viewFlags = Object.fromEntries(['present','is_view','security_invoker','authenticated_select','anon_select','public_select',
      'authenticated_any_privilege','anon_any_privilege','public_any_privilege'].map(key => [key,boolean(view[key])]));
    if (viewFlags.is_view) {
      if (!viewFlags.present || typeof view.definition !== 'string' || view.definition.length > 100000 || !/^\s*(SELECT|WITH)\b/i.test(view.definition) || view.definition.includes('\u0000')) throw new Error('invalid lead view definition');
    } else if (view.definition !== null) throw new Error('missing lead view has a definition');
    if (!viewFlags.present && Object.values(viewFlags).some(Boolean)) throw new Error('missing lead view has metadata');
    const migration = object(row.migration);
    if (migration.version !== '20261125110000') throw new Error('unexpected lead migration');
    const migrationRecorded = boolean(migration.recorded);
    const advancedMigration = object(row.advanced_migration);
    if (advancedMigration.version !== '20261125130000') throw new Error('unexpected advanced lead migration');
    const advancedMigrationRecorded = boolean(advancedMigration.recorded);
    const indexes = array(row.indexes).map(value => {
      const i = object(value);
      const table = enumeration(i.table, ['mat_lead_pool', 'lead_bundle_items', 'lead_bundle_events', 'lead_resale_ledger']);
      if (typeof i.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(i.name)) throw new Error('invalid lead index name');
      if (typeof i.definition !== 'string' || i.definition.length > 20000 || i.definition.includes('\u0000') || !i.definition.startsWith(`CREATE INDEX ${i.name} ON public.${table} `) && !i.definition.startsWith(`CREATE UNIQUE INDEX ${i.name} ON public.${table} `)) throw new Error('invalid lead index definition');
      return { table, name: i.name, definition: i.definition };
    });
    return { application_functions_executed: false, lead_rows_read: false, auth_claims_changed: false, functions, indexes,
      candidate_view: { name: view.name, ...viewFlags, definition: view.definition },
      migration: { version: migration.version, recorded: migrationRecorded },
      advanced_migration: { version: advancedMigration.version, recorded: advancedMigrationRecorded } };
  }
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
    const names = ['producer_profile_detail','scoped_production_projection_uncached','agent_carrier_book','home_conversion_people_range','home_conversion_people_range_uncached','home_application_cohort','scoped_production_scoreboard_uncached','production_policy_cohort'];
    return Object.fromEntries(names.map(name => {
      const value = row[name];
      if (value !== null && (typeof value !== 'string' || value.length > 200000 || !value.startsWith('CREATE OR REPLACE FUNCTION public.'))) throw new Error('invalid function definition');
      return [name,value];
    }));
  }
  if (name === 'release') {
    const row = object(value);
    if (row.base_sha !== RELEASE_BASE_SHA || row.application_functions_executed !== false) throw new Error('invalid release readback boundary');
    if (!Array.isArray(row.missing_base_versions) || row.missing_base_versions.length > 2000
      || row.missing_base_versions.some(v => typeof v !== 'string' || !/^\d{14}$/.test(v))
      || new Set(row.missing_base_versions).size !== row.missing_base_versions.length) throw new Error('invalid migration version list');
    const expected = count(row.expected_base_count), recorded = count(row.recorded_base_count);
    if (expected === 0 || expected > 2000 || recorded + row.missing_base_versions.length !== expected) throw new Error('migration counts do not reconcile');
    const migrations = array(row.new_migrations).map(value => {
      const r = object(value);
      return { version: enumeration(r.version, RELEASE_VERSIONS), recorded: boolean(r.recorded) };
    });
    if (migrations.length !== RELEASE_VERSIONS.length || new Set(migrations.map(r => r.version)).size !== RELEASE_VERSIONS.length) throw new Error('invalid release migration set');
    const f = object(row.policy_cohort);
    if (f.arguments !== null && (typeof f.arguments !== 'string' || f.arguments.length > 500 || !/^[A-Za-z0-9_ :,().\[\]]*$/.test(f.arguments))) throw new Error('invalid cohort argument metadata');
    if (f.definition_md5 !== null && (typeof f.definition_md5 !== 'string' || !/^[a-f0-9]{32}$/.test(f.definition_md5))) throw new Error('invalid definition hash');
    return { base_sha: row.base_sha, expected_base_count: expected, recorded_base_count: recorded,
      missing_base_versions: row.missing_base_versions, new_migrations: migrations, application_functions_executed: false,
      policy_cohort: { ...Object.fromEntries(COHORT_CONTRACT_FLAGS.map(key => [key,boolean(f[key])])), arguments: f.arguments, definition_md5: f.definition_md5 } };
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
    if (![401,403].includes(response.status) || !botToken) throw new Error(`database query HTTP ${response.status}: ${(await response.text()).slice(0,2000)}`);
  }
  if (!botToken) throw new Error('database credential unavailable');
  const response = await fetch(`https://${PROJECT}.supabase.co/functions/v1/bot-sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`fixed query HTTP ${response.status}: ${(await response.text()).slice(0,2000)}`);
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
    else { output.sections[name] = { ok: false, reason: 'Read-only diagnostic unavailable or invalid aggregate response.', detail: String(result.reason?.message ?? 'request failed').slice(0,2500) }; process.exitCode = 1; }
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
