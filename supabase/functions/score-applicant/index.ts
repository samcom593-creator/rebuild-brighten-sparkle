import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

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

const BodySchema = v.object({
  applicationId: v.string({ max: 64 }),
  scoreAll: v.any(),
});

Deno.serve(
  createHandler(
    {
      functionName: "score-applicant",
      // 30 calls per minute is generous for both per-app and bulk scoring
      rateLimit: { maxRequests: 30, windowSeconds: 60 },
    },
    async (req) => {
      const body = await parseBody(req, BodySchema);
      const applicationId = body.applicationId;
      const scoreAll = !!body.scoreAll;

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      if (scoreAll) {
        const { data: apps, error } = await supabase
          .from("applications")
          .select(
            "id, license_status, has_insurance_experience, years_experience, previous_production, desired_income, phone, instagram_handle, city, state, license_progress, referral_source"
          )
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

        return jsonResponse({ success: true, updated });
      }

      if (!applicationId) {
        return errorResponse("applicationId required", 400, "MISSING_APP_ID");
      }

      const { data: app, error } = await supabase
        .from("applications")
        .select(
          "id, license_status, has_insurance_experience, years_experience, previous_production, desired_income, phone, instagram_handle, city, state, license_progress, referral_source"
        )
        .eq("id", applicationId)
        .maybeSingle();

      if (error || !app) {
        return errorResponse("Application not found", 404, "NOT_FOUND");
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

      return jsonResponse({ success: true, score, tier });
    }
  )
);
