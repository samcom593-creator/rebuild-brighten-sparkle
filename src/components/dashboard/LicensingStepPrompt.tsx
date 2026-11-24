/**
 * LicensingStepPrompt (MP-LICENSING-STEP, 2026-11-23): an unlicensed agent says where they are in one tap.
 *
 * 24 of 28 active unlicensed agents were recorded only as "unlicensed", so nobody could tell who was a week
 * from a license and who had not started. Source: my_licensing_step(). Write: set_agent_license_progress(),
 * which already allows a person to set their own step and mirrors it onto their application.
 * Renders nothing for a licensed agent, a person with no agent record, or a failed read.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { errorMessage } from "@/lib/queryState";
import { LICENSING_STEPS, nextStepLine, normalizeStep, type LicensingStep } from "@/lib/licensingStep";

type RpcFn<T> = (fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
interface MyStep { agent_id: string | null; licensed?: boolean; step?: string | null }

export const LICENSING_STEP_KEY = ["my-licensing-step"] as const;

export function LicensingStepPrompt() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<LicensingStep | null>(null);
  const query = useQuery({
    queryKey: LICENSING_STEP_KEY,
    queryFn: async (): Promise<MyStep> => {
      const { data, error } = await (supabase.rpc as unknown as RpcFn<MyStep>)("my_licensing_step");
      if (error) throw new Error(error.message);
      return data ?? { agent_id: null };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const me = query.data;
  if (!me?.agent_id || me.licensed) return null;
  const current = normalizeStep(me.step);

  const save = async (step: LicensingStep) => {
    if (saving) return;
    setSaving(step);
    try {
      const { error } = await (supabase.rpc as unknown as RpcFn<unknown>)("set_agent_license_progress", {
        p_agent_id: me.agent_id, p_progress: step, p_test_date: null,
      });
      if (error) throw new Error(error.message);
      toast.success("Saved. Your next step is below.");
      await queryClient.invalidateQueries({ queryKey: LICENSING_STEP_KEY });
    } catch (err) {
      toast.error(errorMessage(err, "That did not save. Try again."));
    } finally {
      setSaving(null);
    }
  };

  return (
    <GlassCard className="border-primary/40 bg-primary/5 p-4" data-testid="licensing-step-prompt">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
          <GraduationCap className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight">Where are you in getting licensed?</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Tap your step so your manager knows how to help.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {LICENSING_STEPS.map((s) => (
              <Button
                key={s.value}
                size="sm"
                variant={current === s.value ? "default" : "outline"}
                aria-pressed={current === s.value}
                disabled={saving !== null}
                onClick={() => save(s.value)}
              >
                {s.label}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-sm text-foreground">
            <span className="font-semibold">Next: </span>{nextStepLine(current)}{" "}
            <Link to="/get-licensed" className="font-medium text-primary hover:underline">Open the licensing guide</Link>
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

export default LicensingStepPrompt;
