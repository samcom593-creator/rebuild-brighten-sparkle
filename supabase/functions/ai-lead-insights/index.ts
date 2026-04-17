import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";

interface InsightsRequest {
  applicationId?: string;
  agentId?: string;
}

Deno.serve(
  createHandler(
    {
      functionName: "ai-lead-insights",
      rateLimit: { maxRequests: 30, windowSeconds: 60 },
    },
    async (req) => {
      const { applicationId, agentId } = (await req.json()) as InsightsRequest;
      if (!applicationId && !agentId) {
        return jsonResponse({ error: "applicationId or agentId required" }, 400);
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      // Gather context
      let context = "";
      if (applicationId) {
        const { data: app } = await supabase
          .from("applications")
          .select(
            "first_name,last_name,email,phone,state,city,license_status,license_progress,status,years_experience,previous_company,previous_production,desired_income,notes,created_at,last_contacted_at,course_purchased_at,exam_passed_at,licensed_at,is_ghosted"
          )
          .eq("id", applicationId)
          .maybeSingle();
        if (!app) return jsonResponse({ error: "Application not found" }, 404);

        const { data: contacts } = await supabase
          .from("contact_history")
          .select("contact_type,subject,notes,created_at")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: false })
          .limit(5);

        context = `LEAD PROFILE:
Name: ${app.first_name} ${app.last_name}
Location: ${app.city ?? "?"}, ${app.state ?? "?"}
License: ${app.license_status} / progress: ${app.license_progress ?? "n/a"}
Status: ${app.status}
Experience: ${app.years_experience ?? 0} yrs at ${app.previous_company ?? "n/a"}
Prior production: $${app.previous_production ?? 0}
Desired income: $${app.desired_income ?? 0}
Created: ${app.created_at}
Last contacted: ${app.last_contacted_at ?? "never"}
Course purchased: ${app.course_purchased_at ?? "no"}
Passed test: ${app.exam_passed_at ?? "no"}
Licensed: ${app.licensed_at ?? "no"}
Ghosted: ${app.is_ghosted ? "yes" : "no"}
Notes: ${app.notes ?? "none"}

RECENT CONTACTS (${contacts?.length ?? 0}):
${(contacts ?? []).map((c: any) => `- ${c.created_at} [${c.contact_type}] ${c.subject ?? ""} ${c.notes ?? ""}`).join("\n") || "(no contact history)"}`;
      } else if (agentId) {
        const { data: agent } = await supabase
          .from("agents")
          .select("display_name,license_status,onboarding_stage,start_date,total_premium,total_policies,total_earnings,is_inactive,is_deactivated")
          .eq("id", agentId)
          .maybeSingle();
        if (!agent) return jsonResponse({ error: "Agent not found" }, 404);

        const { data: prod } = await supabase
          .from("daily_production")
          .select("production_date,aop,deals_closed,presentations,hours_called")
          .eq("agent_id", agentId)
          .order("production_date", { ascending: false })
          .limit(14);

        context = `AGENT PROFILE:
Name: ${agent.display_name}
License: ${agent.license_status}
Stage: ${agent.onboarding_stage ?? "n/a"}
Started: ${agent.start_date ?? "?"}
Lifetime: $${agent.total_premium ?? 0} premium, ${agent.total_policies ?? 0} policies, $${agent.total_earnings ?? 0} earnings
Inactive: ${agent.is_inactive ? "yes" : "no"} / Deactivated: ${agent.is_deactivated ? "yes" : "no"}

LAST 14 PRODUCTION DAYS:
${(prod ?? []).map((p: any) => `- ${p.production_date}: $${p.aop} / ${p.deals_closed} deals / ${p.presentations} pres / ${p.hours_called}h`).join("\n") || "(no production)"}`;
      }

      // Call Lovable AI Gateway
      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!apiKey) return jsonResponse({ error: "LOVABLE_API_KEY not configured" }, 500);

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You are a senior sales coach for an insurance agency. Analyze the lead/agent and respond ONLY by calling the provided tool. Be specific, actionable, and brutally honest. No fluff.",
            },
            { role: "user", content: context },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "lead_insights",
                description: "Structured insights about a lead or agent",
                parameters: {
                  type: "object",
                  properties: {
                    score: {
                      type: "integer",
                      description: "0-100 lead/agent quality score",
                    },
                    tier: {
                      type: "string",
                      enum: ["hot", "warm", "cold", "dead"],
                    },
                    summary: {
                      type: "string",
                      description: "1-sentence executive summary",
                    },
                    strengths: {
                      type: "array",
                      items: { type: "string" },
                      description: "Up to 3 specific strengths",
                    },
                    risks: {
                      type: "array",
                      items: { type: "string" },
                      description: "Up to 3 specific risks or red flags",
                    },
                    next_actions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          action: { type: "string" },
                          priority: { type: "string", enum: ["high", "medium", "low"] },
                          why: { type: "string" },
                        },
                        required: ["action", "priority", "why"],
                      },
                      description: "Top 3 recommended next actions",
                    },
                    suggested_message: {
                      type: "string",
                      description: "A short, ready-to-send SMS or email opener",
                    },
                  },
                  required: ["score", "tier", "summary", "strengths", "risks", "next_actions", "suggested_message"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "lead_insights" } },
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        if (aiResponse.status === 429) {
          return jsonResponse({ error: "Rate limited. Try again in a moment." }, 429);
        }
        if (aiResponse.status === 402) {
          return jsonResponse({ error: "AI credits exhausted. Add funds in workspace usage." }, 402);
        }
        return jsonResponse({ error: `AI gateway: ${errText}` }, 500);
      }

      const aiJson = await aiResponse.json();
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        return jsonResponse({ error: "AI returned no structured insights" }, 500);
      }

      const insights = JSON.parse(toolCall.function.arguments);
      return jsonResponse({ insights, model: aiJson.model });
    }
  )
);
