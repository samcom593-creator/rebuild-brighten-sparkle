// apex-mcp — minimal MCP-over-HTTP server so Sam can control Claude + Codex
// from his Poke app. Implements the JSON-RPC subset Poke needs:
//   - initialize
//   - tools/list
//   - tools/call
// Transport: HTTP POST (Poke supports both SSE and HTTP for MCP).
// Auth: Bearer APEX_MCP_TOKEN (set by Sam in Poke when registering the server).
// Each tool drops a command into apex_commands table; the local dispatcher
// daemon polls + runs Claude or Codex with the request.
// Built 2026-06-09. Public URL: <SUPABASE_URL>/functions/v1/apex-mcp
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APEX_MCP_TOKEN = Deno.env.get("APEX_MCP_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-poke-user-id",
};

const TOOLS = [
  {
    name: "claude_run",
    description:
      "Send a command/question to Claude (Anthropic Opus) running on Sam's Mac. " +
      "Use for: heavy product judgment, multi-file refactors, audits, content review, " +
      "strategy. Returns a queue_id; the run completes asynchronously and the response " +
      "is posted back to this Poke conversation when done.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The full instruction or question for Claude." },
        cwd: { type: "string", description: "Optional working directory (default: rebuild-brighten-sparkle repo)." },
        priority: { type: "string", enum: ["normal", "urgent"], description: "Urgent jumps the queue." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "codex_run",
    description:
      "Send a code-implementation task to Codex CLI (OpenAI o1-codex) on Sam's Mac. " +
      "Use for: bounded code changes, test writing, migrations, edge-fn implementations, " +
      "anything code-heavy that's cheaper to spend Codex tokens on than Claude tokens. " +
      "Returns a queue_id; commit SHA posted back when shipped.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Scoped one-line task for Codex." },
        cwd: { type: "string", description: "Optional working directory." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "status",
    description:
      "Get current Apex command-center status: pending command count, last AgentLink sync, " +
      "last commit SHA, agentlink book truth ($M + deal count), poke queue depth. Use this " +
      "to ask 'what's running?'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "queue_peek",
    description: "Show the last N commands sent to Claude/Codex, their state, and results.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", default: 5 } },
    },
  },
];

interface JsonRpcReq { jsonrpc?: string; id?: number | string; method: string; params?: Record<string, unknown>; }

function rpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers: corsHeaders });
}
function rpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status: 200, headers: corsHeaders });
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  // Auth gate (matches Poke's Bearer header)
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.replace(/^Bearer\s+/i, "").trim();
  if (APEX_MCP_TOKEN && presented !== APEX_MCP_TOKEN) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  let rpc: JsonRpcReq;
  try { rpc = await req.json(); }
  catch { return rpcError(null, -32700, "Parse error"); }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const pokeUserId = req.headers.get("x-poke-user-id") ?? "sam";

  switch (rpc.method) {
    case "initialize":
      return rpcResult(rpc.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "apex-command-center", version: "1.0.0" },
      });

    case "tools/list":
      return rpcResult(rpc.id, { tools: TOOLS });

    case "tools/call": {
      const params = (rpc.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const toolName = params.name ?? "";
      const args = params.arguments ?? {};

      if (toolName === "status") {
        const [{ data: bookTruth }, { data: pendingCmds }, { data: lastCmd }] = await Promise.all([
          sb.from("v_agentlink_book_truth").select("*").maybeSingle(),
          sb.from("apex_commands").select("id", { count: "exact" }).is("completed_at", null),
          sb.from("apex_commands").select("id, kind, status, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const truth = bookTruth as Record<string, unknown> | null;
        const text = [
          `🏛️ APEX Command Center`,
          truth ? `Book: ${truth.total_deals} deals · $${Number(truth.total_annual_premium ?? 0).toLocaleString()}` : "Book: unknown",
          truth ? `This month: ${truth.deals_this_month} deals · $${Number(truth.premium_this_month ?? 0).toLocaleString()}` : "",
          `Pending commands: ${pendingCmds?.length ?? 0}`,
          lastCmd ? `Last command: ${(lastCmd as Record<string, unknown>).kind} (${(lastCmd as Record<string, unknown>).status})` : "",
        ].filter(Boolean).join("\n");
        return rpcResult(rpc.id, { content: [{ type: "text", text }] });
      }

      if (toolName === "queue_peek") {
        const limit = Math.min(Number(args.limit ?? 5), 25);
        const { data } = await sb
          .from("apex_commands")
          .select("id, kind, prompt, status, created_at, completed_at, result_summary, commit_sha")
          .order("created_at", { ascending: false })
          .limit(limit);
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        const text = rows.length
          ? rows.map((r) => `#${r.id} [${r.kind}/${r.status}] ${(String(r.prompt ?? "")).slice(0, 80)}${r.commit_sha ? ` → ${String(r.commit_sha).slice(0,7)}` : ""}`).join("\n")
          : "Queue empty.";
        return rpcResult(rpc.id, { content: [{ type: "text", text }] });
      }

      if (toolName === "claude_run" || toolName === "codex_run") {
        const prompt = String(args.prompt ?? "").trim();
        if (!prompt) return rpcError(rpc.id, -32602, "Missing 'prompt' argument");
        const kind = toolName === "claude_run" ? "claude" : "codex";
        const cwd = String(args.cwd ?? "/Users/samjames/projects/rebuild-brighten-sparkle");
        const priority = String(args.priority ?? "normal");
        const { data, error } = await sb
          .from("apex_commands")
          .insert({
            kind, prompt, cwd, priority, status: "queued",
            requested_by: pokeUserId, source: "poke",
          })
          .select("id")
          .single();
        if (error) return rpcError(rpc.id, -32000, error.message);
        const id = (data as Record<string, unknown>).id;
        return rpcResult(rpc.id, {
          content: [{
            type: "text",
            text: `✅ Queued ${kind} command #${id}. Dispatcher daemon will pick it up within 30s. ` +
                  `Reply 'status' to check progress, or watch this conversation — the result lands here when done.`,
          }],
        });
      }

      return rpcError(rpc.id, -32601, `Unknown tool: ${toolName}`);
    }

    default:
      return rpcError(rpc.id, -32601, `Unknown method: ${rpc.method}`);
  }
};

serve(handler);
