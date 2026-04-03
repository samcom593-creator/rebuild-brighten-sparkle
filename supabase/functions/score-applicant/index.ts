import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ScoringFactors {
  hasLicense: boolean;
  hasExperience: boolean;
  yearsExperience: number;
  hasPhone: boolean;
  hasInstagram: boolean;
  previousProduction: number;
  desiredIncome: number;
  hasCity: boolean;
  hasState: boolean;
  licenseProgress: string | null;
  referralSource: string | null;
}

function calculateScore(factors: ScoringFactors): { score: number; tier: string } {
  let score = 30; // base

  // License (up to +25)
  if (factors.hasLicense) score += 25;
  else if (factors.licenseProgress === "passed_test") score += 20;
  else if (factors.licenseProgress === "waiting_on_license") score += 18;
  else if (factors.licenseProgress === "course_purchased") score += 10;

  // Experience (up to +20)
  if (factors.hasExperience) {
    score += 10;
    if (factors.yearsExperience >= 5) score += 10;
    else if (factors.yearsExperience >= 2) score += 7;
    else if (factors.yearsExperience >= 1) score += 4;
  }

  // Previous production (up to +10)
  if (factors.previousProduction >= 100000) score += 10;
  else if (factors.previousProduction >= 50000) score += 7;
  else if (factors.previousProduction > 0) score += 3;

  // Desired income signals motivation (up to +5)
  if (factors.desiredIncome >= 100000) score += 5;
  else if (factors.desiredIncome >= 50000) score += 3;

  // Contact completeness (up to +5)
  if (factors.hasPhone) score += 3;
  if (factors.hasInstagram) score += 2;

  // Location (up to +3)
  if (factors.hasCity && factors.hasState) score += 3;

  // Referral source bonus (up to +7)
  if (factors.referralSource) {
    const src = factors.referralSource.toLowerCase();
    if (src.includes("referral") || src.includes("agent")) score += 7;
    else if (src.includes("instagram") || src.includes("social")) score += 4;
    else score += 2;
  }

  // Cap at 100
  score = Math.min(100, Math.max(0, score));

  // Tier
  let tier: string;
  if (score >= 80) tier = "hot";
  else if (score >= 60) tier = "warm";
  else if (score >= 40) tier = "cool";
  else tier = "cold";

  return { score, tier };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { applicationId, scoreAll } = await req.json();

    if (scoreAll) {
      // Score all unscored applications
      const { data: apps, error } = await supabase
        .from("applications")
        .select("id, license_status, has_insurance_experience, years_experience, previous_production, desired_income, phone, instagram_handle, city, state, license_progress, referral_source")
        .is("ai_score_tier", null)
        .is("terminated_at", null)
        .limit(500);

      if (error) throw error;

      let updated = 0;
      for (const app of apps || []) {
        const { score, tier } = calculateScore({
          hasLicense: app.license_status === "licensed",
          hasExperience: !!app.has_insurance_experience,
          yearsExperience: app.years_experience || 0,
          hasPhone: !!app.phone,
          hasInstagram: !!app.instagram_handle,
          previousProduction: app.previous_production || 0,
          desiredIncome: app.desired_income || 0,
          hasCity: !!app.city,
          hasState: !!app.state,
          licenseProgress: app.license_progress,
          referralSource: app.referral_source,
        });

        await supabase
          .from("applications")
          .update({ lead_score: score, ai_score_tier: tier })
          .eq("id", app.id);
        updated++;
      }

      return new Response(JSON.stringify({ success: true, updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!applicationId) {
      return new Response(JSON.stringify({ error: "applicationId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: app, error } = await supabase
      .from("applications")
      .select("id, license_status, has_insurance_experience, years_experience, previous_production, desired_income, phone, instagram_handle, city, state, license_progress, referral_source")
      .eq("id", applicationId)
      .single();

    if (error || !app) {
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { score, tier } = calculateScore({
      hasLicense: app.license_status === "licensed",
      hasExperience: !!app.has_insurance_experience,
      yearsExperience: app.years_experience || 0,
      hasPhone: !!app.phone,
      hasInstagram: !!app.instagram_handle,
      previousProduction: app.previous_production || 0,
      desiredIncome: app.desired_income || 0,
      hasCity: !!app.city,
      hasState: !!app.state,
      licenseProgress: app.license_progress,
      referralSource: app.referral_source,
    });

    await supabase
      .from("applications")
      .update({ lead_score: score, ai_score_tier: tier })
      .eq("id", applicationId);

    return new Response(JSON.stringify({ success: true, score, tier }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
