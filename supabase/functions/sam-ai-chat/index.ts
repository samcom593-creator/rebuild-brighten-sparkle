// Sam's private AI chat proxy.
// Receives {messages, system?, model?} from the agencyhubos telegram bridge,
// forwards to Anthropic API using ANTHROPIC_API_KEY supabase secret,
// returns Claude's response.
//
// Auth: bot-sql.token (same token the bridge already carries).
//
// Why this exists: the bridge runs on the mini, but the working Anthropic
// API key only lives as a supabase secret. This fn lets the mini's bridge
// get real Claude responses without storing an API key on the mini.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405, headers: corsHeaders });
  }

  // Auth: shared bot-sql token (passed as Bearer)
  const expected = Deno.env.get("BOT_SQL_TOKEN") ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || got !== expected) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    system?: string;
    model?: string;
    max_tokens?: number;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const messages = body.messages ?? [];
  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "no messages" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const model = body.model || Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
  const max_tokens = body.max_tokens ?? 1024;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        system: body.system,
        messages,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "anthropic", status: r.status, detail: data }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = data?.content?.[0]?.text ?? "";
    return new Response(
      JSON.stringify({
        ok: true,
        text,
        model: data?.model,
        usage: data?.usage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
