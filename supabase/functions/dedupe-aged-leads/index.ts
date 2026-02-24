import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  licensing: 2,
  hired: 3,
  contracted: 4,
  not_qualified: -1,
};

const LICENSE_RANK: Record<string, number> = {
  unknown: 0,
  unlicensed: 1,
  licensed: 2,
};

function cleanPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is admin
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Check admin role
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Fetch all aged leads
    const { data: leads, error: fetchError } = await adminClient
      .from("aged_leads")
      .select("id, email, phone, notes, motivation, instagram_handle, about_me, status, license_status, contacted_at, last_contacted_at, assigned_manager_id, created_at, processed_at, first_name, last_name");

    if (fetchError) throw fetchError;
    if (!leads || leads.length === 0) {
      return new Response(JSON.stringify({ merged: 0, deleted: 0, message: "No aged leads found" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Build duplicate groups by connected keys (email and/or phone)
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      const p = parent.get(id) || id;
      if (p === id) return id;
      const root = find(p);
      parent.set(id, root);
      return root;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };

    for (const lead of leads) parent.set(lead.id, lead.id);

    const emailBuckets = new Map<string, string[]>();
    const phoneBuckets = new Map<string, string[]>();

    for (const lead of leads) {
      const emailKey = lead.email?.toLowerCase().trim();
      const phoneKey = cleanPhone(lead.phone);

      if (emailKey && emailKey.length > 0) {
        const ids = emailBuckets.get(emailKey) || [];
        ids.push(lead.id);
        emailBuckets.set(emailKey, ids);
      }

      if (phoneKey) {
        const ids = phoneBuckets.get(phoneKey) || [];
        ids.push(lead.id);
        phoneBuckets.set(phoneKey, ids);
      }
    }

    for (const ids of emailBuckets.values()) {
      if (ids.length > 1) {
        const head = ids[0];
        for (let i = 1; i < ids.length; i++) union(head, ids[i]);
      }
    }

    for (const ids of phoneBuckets.values()) {
      if (ids.length > 1) {
        const head = ids[0];
        for (let i = 1; i < ids.length; i++) union(head, ids[i]);
      }
    }

    const groupMap = new Map<string, typeof leads>();
    for (const lead of leads) {
      const root = find(lead.id);
      if (!groupMap.has(root)) groupMap.set(root, []);
      groupMap.get(root)!.push(lead);
    }

    let groupsMerged = 0;
    let totalDeleted = 0;
    const keeperIds: string[] = [];

    for (const [_, group] of groupMap) {
      if (group.length <= 1) continue;

      // Keeper selection: latest last_contacted_at, fallback newest created_at
      group.sort((a, b) => {
        const aContact = a.last_contacted_at ? new Date(a.last_contacted_at).getTime() : 0;
        const bContact = b.last_contacted_at ? new Date(b.last_contacted_at).getTime() : 0;
        if (bContact !== aContact) return bContact - aContact;
        const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bCreated - aCreated;
      });

      const keeper = group[0];
      const others = group.slice(1);

      // Merge strategy
      const allNotes = group
        .map((l) => l.notes?.trim())
        .filter((n): n is string => !!n && n.length > 0);
      const uniqueNotes = [...new Set(allNotes)];
      const mergedNotes = uniqueNotes.length > 0 ? uniqueNotes.join("\n---\n") : keeper.notes;

      // Max last_contacted_at
      const allLastContacted = group
        .map((l) => l.last_contacted_at)
        .filter((d): d is string => !!d)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      const mergedLastContacted = allLastContacted[0] || keeper.last_contacted_at;

      // Earliest contacted_at
      const allContacted = group
        .map((l) => l.contacted_at)
        .filter((d): d is string => !!d)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const mergedContacted = allContacted[0] || keeper.contacted_at;

      // Fill missing fields from duplicates
      const mergedMotivation = keeper.motivation || others.find((o) => o.motivation)?.motivation || null;
      const mergedAboutMe = keeper.about_me || others.find((o) => o.about_me)?.about_me || null;
      const mergedInstagram = keeper.instagram_handle || others.find((o) => o.instagram_handle)?.instagram_handle || null;
      const mergedManagerId = keeper.assigned_manager_id || others.find((o) => o.assigned_manager_id)?.assigned_manager_id || null;

      // Best status
      const bestStatus = group.reduce((best, l) => {
        const rank = STATUS_RANK[l.status || "new"] ?? 0;
        const bestRank = STATUS_RANK[best] ?? 0;
        return rank > bestRank ? (l.status || "new") : best;
      }, keeper.status || "new");

      // Best license_status
      const bestLicense = group.reduce((best, l) => {
        const rank = LICENSE_RANK[l.license_status || "unknown"] ?? 0;
        const bestRank = LICENSE_RANK[best] ?? 0;
        return rank > bestRank ? (l.license_status || "unknown") : best;
      }, keeper.license_status || "unknown");

      // Update keeper
      const { error: updateError } = await adminClient
        .from("aged_leads")
        .update({
          notes: mergedNotes,
          last_contacted_at: mergedLastContacted,
          contacted_at: mergedContacted,
          motivation: mergedMotivation,
          about_me: mergedAboutMe,
          instagram_handle: mergedInstagram,
          assigned_manager_id: mergedManagerId,
          status: bestStatus,
          license_status: bestLicense,
        })
        .eq("id", keeper.id);

      if (updateError) {
        console.error(`Failed to update keeper ${keeper.id}:`, updateError);
        continue;
      }

      // Delete others
      const otherIds = others.map((o) => o.id);
      const { error: deleteError } = await adminClient
        .from("aged_leads")
        .delete()
        .in("id", otherIds);

      if (deleteError) {
        console.error(`Failed to delete duplicates for keeper ${keeper.id}:`, deleteError);
        continue;
      }

      groupsMerged++;
      totalDeleted += otherIds.length;
      keeperIds.push(keeper.id);
    }

    console.log(`Dedupe complete: ${groupsMerged} groups merged, ${totalDeleted} records deleted`);

    return new Response(
      JSON.stringify({
        merged: groupsMerged,
        deleted: totalDeleted,
        keeperIds,
        message: `Merged ${groupsMerged} groups, removed ${totalDeleted} duplicate records`,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in dedupe-aged-leads:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
