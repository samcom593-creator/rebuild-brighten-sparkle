import { describe, expect, it } from "vitest";
import { presentPlaqueDate, presentPlaqueMetric } from "@/components/awards/plaqueAwardPresentation";

describe("recorded plaque metric units", () => {
  it("keeps whole dollars clean and fractional dollars at two cents", () => {
    expect(presentPlaqueMetric({ milestone_type: "first_deal_ever", amount: 24750.5 })).toMatchObject({ kind: "alp", value: "$24,750.50", label: "Recorded ALP" });
    expect(presentPlaqueMetric({ milestone_type: "first_deal_ever", amount: 24750 })).toMatchObject({ value: "$24,750" });
  });

  it("keeps legacy premium neutral and comeback improvement separate from a total", () => {
    expect(presentPlaqueMetric({ milestone_type: "single_day", amount: 5000 })).toMatchObject({ kind: "premium", value: "$5,000", label: "Recorded premium" });
    expect(presentPlaqueMetric({ milestone_type: "comeback_champion", amount: 2500 })).toMatchObject({ kind: "premium_increase", value: "$2,500", label: "Recorded premium increase" });
  });

  it.each([
    ["day_on_the_board", "Daily hires"], ["day_recruiter_rising", "Daily hires"], ["day_hiring_champion", "Daily hires"],
    ["month_first_hire", "Monthly hires"], ["month_builder", "Monthly hires"], ["month_team_builder", "Monthly hires"],
    ["month_agency_builder", "Monthly hires"], ["month_empire_builder", "Monthly hires"],
    ["hiring_champion", "Daily hires"], ["recruiter_rising", "Daily hires"], ["team_builder", "Weekly hires"],
  ])("preserves the count unit for %s", (milestone_type, label) => {
    expect(presentPlaqueMetric({ milestone_type, amount: 5 })).toMatchObject({ kind: "hires", value: "5", label, missingPremium: false });
  });

  it.each(["hot_streak", "on_fire", "unstoppable", "streak_5", "streak_10", "streak_20"])("shows days for %s", milestone_type => {
    expect(presentPlaqueMetric({ milestone_type, amount: 5 })).toMatchObject({ kind: "days", value: "5", label: "Streak days", missingPremium: false });
  });

  it("withholds invalid counts and missing premium without inventing a zero", () => {
    expect(presentPlaqueMetric({ milestone_type: "day_hiring_champion", amount: 1.5 })).toMatchObject({ value: null, missingText: "Hire count not on file", missingPremium: false });
    expect(presentPlaqueMetric({ milestone_type: "hot_streak", amount: null })).toMatchObject({ value: null, missingText: "Day count not on file", missingPremium: false });
    expect(presentPlaqueMetric({ milestone_type: "single_day", amount: 0 })).toMatchObject({ value: null, missingPremium: true });
    expect(presentPlaqueMetric({ milestone_type: "first_deal_ever", amount: null })).toMatchObject({ value: null, missingPremium: true });
    expect(presentPlaqueMetric({ milestone_type: "day_on_the_board", amount: 0 })).toMatchObject({ value: "0", missingPremium: false });
  });

  it("does not infer dollars or units from a pasted milestone title", () => {
    expect(presentPlaqueMetric({ milestone_type: "10K CLUB", amount: 10000 })).toMatchObject({ kind: "unknown", value: "10,000", label: "Recorded value · unit unavailable", missingPremium: false });
    expect(presentPlaqueMetric({ milestone_type: "unmapped", amount: null })).toMatchObject({ value: null, missingText: "Value not on file", missingPremium: false });
    expect(presentPlaqueMetric({ milestone_type: "constructor", amount: 5 })).toMatchObject({ kind: "unknown", value: "5" });
  });

  it("identifies month-start recruiting buckets without claiming the first was the earned day", () => {
    expect(presentPlaqueDate({ milestone_type: "month_team_builder", milestone_date: "2026-11-01" })).toEqual({ label: "Milestone month", value: "November 2026" });
    expect(presentPlaqueDate({ milestone_type: "day_hiring_champion", milestone_date: "2026-11-24" })).toEqual({ label: "Milestone date", value: "Nov 24, 2026" });
    expect(presentPlaqueDate({ milestone_type: "first_deal_ever", milestone_date: "2026-02-30" })).toEqual({ label: "Milestone date", value: "Date not on file" });
  });
});
