/**
 * AgentNameLink — clickable agent name that opens the AgentProfileDrawer.
 *
 * 2026-06-15 — Sam directive (voice): "I tap their name, I should push a pull
 * up that I'm inside the CRM." Use anywhere an agent name renders — sidebar
 * search results, Hierarchy legs, RecruitingTracker per-recruiter cards,
 * DashboardApplicants upline column, DashboardCRM rows.
 */

import type { ComponentProps, ReactNode } from "react";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { cn } from "@/lib/utils";

interface Props extends Omit<ComponentProps<"button">, "onClick" | "type"> {
  agentId: string;
  children: ReactNode;
  /** Default styling adds a subtle hover underline; pass `bare` to keep callsite's classes only. */
  variant?: "default" | "bare";
}

export function AgentNameLink({ agentId, children, className, variant = "default", ...rest }: Props) {
  const openAgent = useAgentProfileDrawer((s) => s.openAgent);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openAgent(agentId);
      }}
      className={cn(
        "text-left inline-flex items-center gap-1.5 max-w-full",
        variant === "default" &&
          "hover:underline underline-offset-2 decoration-dotted hover:text-primary transition-colors cursor-pointer",
        className,
      )}
      style={{ touchAction: "manipulation" }}
      {...rest}
    >
      {children}
    </button>
  );
}
