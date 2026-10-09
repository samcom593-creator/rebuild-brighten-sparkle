#!/usr/bin/env node
// Live check of the exact PostgREST calls the Launch Board's save layer makes (src/lib/contentProjects.ts), run as a real
// admin session against the real database. The unit tests prove the logic against an in-memory fake; only the real API
// can prove the syntax (JSON-path filters, jsonb inserts, unique-violation codes, row security).
//
// Every row it writes is synthetic and keyed "synth:e2e:<run>", is deleted at the end, and the run verifies none is
// left. The admin login it creates is ended at the end. Never touches a real card, post or dismissal.
//
// Run from a directory where `@supabase/supabase-js` resolves (the repo root):  node scripts/tests/e2e-content-picks.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const home = homedir();
const read = (p) => readFileSync(`${home}/.config/apex-creds/${p}`, "utf8").trim();
const SURL = "https://xrzweoneiieddzxogewk.supabase.co";
const SVC = read("supabase-service.key");
const ANON = read("supabase.anon");
const EMAIL = process.env.APEX_ADMIN_EMAIL || "sam.com593@gmail.com";
const RUN = `${Date.now().toString(36)}`;
const KEY = `synth:e2e:${RUN}`;
const KEY2 = `synth:e2e:${RUN}:b`;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `   ${detail}`}`); };

async function mint() {
  const gen = await fetch(`${SURL}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", email: EMAIL }) }).then((r) => r.json());
  const hashed = gen.hashed_token || gen.properties?.hashed_token;
  const sess = await fetch(`${SURL}/auth/v1/verify`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: hashed }) }).then((r) => r.json());
  if (!sess.access_token) throw new Error("could not mint an admin session");
  return sess.access_token;
}

const token = await mint();
const db = createClient(SURL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
let cardId = null;
try {
  const row = (title, key) => ({ title, brand: "SH", content_type: "short", job: "REACH", hook: "synthetic", caption: "", clip: "", status: "record", day: 5, cta: "", owner: "", record_script: "FILM: synthetic\n- [ ] 1. one\n- [ ] 2. two", edit_prompt: "", brief: { idea_key: key, source: "bank", premise: "synthetic" } });

  // create
  const a = await db.from("content_cards").insert(row("SYNTHETIC e2e (safe to delete)", KEY)).select("*").single();
  check("insert a card with a jsonb brief", !a.error && a.data?.brief?.idea_key === KEY, JSON.stringify(a.error));
  cardId = a.data?.id ?? null;

  // duplicate is refused with the unique-violation code the app handles
  const b = await db.from("content_cards").insert(row("SYNTHETIC e2e duplicate", KEY)).select("*").single();
  check("a second live card for the same idea key is refused with 23505", b.error?.code === "23505", JSON.stringify(b.error));

  // the JSON-path re-read the app uses after losing a race
  const c = await db.from("content_cards").select("*").filter("brief->>idea_key", "eq", KEY).is("archived_at", null).maybeSingle();
  check("re-read by brief->>idea_key finds exactly the first card", !c.error && c.data?.id === cardId, JSON.stringify(c.error));

  // pack save returns the stored row
  const d = await db.from("content_cards").update({ record_script: "FILM: synthetic\n- [x] 1. one\n- [ ] 2. two" }).eq("id", cardId).select("*").maybeSingle();
  check("saving the pack returns the stored row", !d.error && d.data?.record_script.includes("[x] 1. one"), JSON.stringify(d.error));
  const miss = await db.from("content_cards").update({ record_script: "x" }).eq("id", "00000000-0000-4000-8000-000000000000").select("*").maybeSingle();
  check("saving to a project that does not exist matches no row (the app reports it as not saved)", !miss.error && miss.data === null, JSON.stringify(miss.error));

  // a different key is fine
  const e = await db.from("content_cards").insert(row("SYNTHETIC e2e second", KEY2)).select("*").single();
  check("a different idea key is accepted", !e.error, JSON.stringify(e.error));

  // dismissals
  const f = await db.from("content_idea_dismissals").insert({ idea_key: KEY, title: "SYNTHETIC e2e", reason: "synthetic" });
  check("dismiss an idea", !f.error, JSON.stringify(f.error));
  const g = await db.from("content_idea_dismissals").insert({ idea_key: KEY, title: "SYNTHETIC e2e" });
  check("dismissing it twice is refused with 23505 (the app treats that as already done)", g.error?.code === "23505", JSON.stringify(g.error));
  const h = await db.from("content_idea_dismissals").select("idea_key, title, reason, dismissed_at").order("dismissed_at", { ascending: false });
  check("the dismissals read returns the row with its reason", !h.error && h.data?.some((x) => x.idea_key === KEY && x.reason === "synthetic"), JSON.stringify(h.error));
  const i = await db.from("content_idea_dismissals").delete().eq("idea_key", KEY);
  const j = await db.from("content_idea_dismissals").select("idea_key").eq("idea_key", KEY);
  check("undo deletes the dismissal", !i.error && j.data?.length === 0, JSON.stringify(i.error));
} finally {
  // cleanup: remove exactly the synthetic rows, then verify none remain
  await db.from("content_idea_dismissals").delete().in("idea_key", [KEY, KEY2]);
  await db.from("content_cards").delete().filter("brief->>idea_key", "in", `(${KEY},${KEY2})`);
  if (cardId) await db.from("content_cards").delete().eq("id", cardId);
  const left = await db.from("content_cards").select("id").or(`brief->>idea_key.eq.${KEY},brief->>idea_key.eq.${KEY2}`);
  const leftD = await db.from("content_idea_dismissals").select("idea_key").in("idea_key", [KEY, KEY2]);
  check("cleanup left no synthetic card or dismissal behind", (left.data?.length ?? 1) === 0 && (leftD.data?.length ?? 1) === 0, JSON.stringify([left.error, leftD.error]));
  // end THIS login only (scope=local), never the person's other sessions
  const out = await fetch(`${SURL}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  check("the admin login this check created was ended", out.status === 204 || out.ok, `status ${out.status}`);
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
