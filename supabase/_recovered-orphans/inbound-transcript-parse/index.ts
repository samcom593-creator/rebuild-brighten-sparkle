// ============================================================================
// RECOVERED MIRROR — NOT THE ORIGINAL SOURCE, AND NOT DEPLOYABLE AS-IS.
//
// slug        : inbound-transcript-parse
// prod version: v139   verify_jwt=true
// entrypoint  : inbound-transcript-parse/index.ts
// recovered   : 2026-09-08 via scripts/recover-edge-function-source.py
// sha256      : 4638b775f7c32f156776d0bf3f564af9fe566f638105135399a9f2fcb992e518   (of the recovered bytes below this banner)
//
// This is what the Supabase edge runtime hands back for a DEPLOYED function, which
// is the TRANSPILED module. Measured against check-stale-onboarding, whose real
// source IS in this repo (14032B repo vs 13682B recovered):
//   PRESERVED  comments, string literals, identifiers, control flow, logic
//   LOST       TypeScript types — `interface` blocks vanish, `!` assertions stripped
//   CHANGED    formatting normalised to Deno's emit
//
// So: behaviourally-equivalent JavaScript, NOT the file someone wrote. It lives
// OUTSIDE supabase/functions/ on purpose — deploy-supabase.yml deploys every
// directory under supabase/functions/ (both the deploy-all and deploy-changed
// paths), so putting it there would push this transpilation over live prod the
// moment a working Management PAT exists. For create-va-account / set-va-account
// that is a live auth-level ban/unban path.
//
// To make one of these authoritative: a human reads it, restores the types, moves
// it to supabase/functions/<slug>/index.ts, and pays the slug down in
// scripts/data/deployed-function-orphans.json.
// ============================================================================

// inbound-transcript-parse — AI-driven structured extraction from voice transcripts
// for /dashboard/inbound-leads. Replaces the regex parser with a Claude call
// that returns typed JSON matching InboundLead fields.
// Sam complaint: "transcript would identify and paste itself, where things should go."
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("PARSE_MODEL") ?? "claude-haiku-4-5-20251001";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const SYSTEM = `You extract structured client-call info from a transcript or note.
Return ONLY JSON matching this schema (no prose, no markdown):
{
  "client_first_name": "<string>",
  "client_last_name": "<string>",
  "phone": "<digits-only string, 10 digits if US, else empty>",
  "email": "<string>",
  "state": "<2-letter US state code or empty>",
  "city": "<string>",
  "problem_type": "<one of: Mortgage protection, Final expense, Retirement / IUL, Life insurance review, Child coverage, Business protection, Annuity, Other>",
  "current_coverage": "<freeform short string describing what they already have, or empty>",
  "desired_solution": "<freeform short string describing what they want>",
  "budget": "<freeform short, e.g. '$80/mo' or '$1000 lump' or empty>",
  "household": "<freeform short, e.g. 'married, 2 kids' or empty>",
  "urgency": "<one of: hot, warm, normal>",
  "next_action": "<freeform short, e.g. 'call back Thursday 3pm' or empty>",
  "notes": "<freeform short summary of anything important not above>"
}

Rules:
- If a field is not mentioned, return empty string.
- urgency: 'hot' if caller said urgent/asap/today, 'warm' if this week, else 'normal'.
- Never invent details. Pull only what's in the transcript.
- Phone: strip everything except digits.
- Return ONLY the JSON object.`;
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return new Response("Method not allowed", {
    status: 405,
    headers: corsHeaders
  });
  if (!ANTHROPIC_KEY) {
    return Response.json({
      error: "ANTHROPIC_API_KEY env not set on the edge function"
    }, {
      status: 500,
      headers: corsHeaders
    });
  }
  let transcript = "";
  try {
    const body = await req.json();
    transcript = String(body?.transcript ?? "").trim();
  } catch  {
    return Response.json({
      error: "Invalid JSON body"
    }, {
      status: 400,
      headers: corsHeaders
    });
  }
  if (!transcript) {
    return Response.json({
      error: "transcript required"
    }, {
      status: 400,
      headers: corsHeaders
    });
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: transcript
          }
        ]
      })
    });
    if (!r.ok) {
      const err = await r.text();
      return Response.json({
        error: `Anthropic ${r.status}: ${err.slice(0, 200)}`
      }, {
        status: 502,
        headers: corsHeaders
      });
    }
    const data = await r.json();
    const text = String(data?.content?.[0]?.text ?? "").trim();
    // Strip code fences if Claude added them despite instructions
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(stripped);
    } catch  {
      return Response.json({
        error: "Model returned non-JSON",
        raw: text.slice(0, 400)
      }, {
        status: 502,
        headers: corsHeaders
      });
    }
    return Response.json(parsed, {
      status: 200,
      headers: corsHeaders
    });
  } catch (e) {
    return Response.json({
      error: e instanceof Error ? e.message : "Unknown error"
    }, {
      status: 500,
      headers: corsHeaders
    });
  }
});
