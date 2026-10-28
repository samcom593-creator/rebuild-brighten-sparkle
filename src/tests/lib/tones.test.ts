import { describe, expect, it } from "vitest";

import {
  TONES,
  TONE_CLASS,
  hireRungTone,
  inboxBucketTone,
  intentTone,
  laneTone,
  mondayTone,
  pipelineStageTone,
  platformTone,
  teamStageTone,
  tonePill,
} from "@/lib/tones";

describe("tones", () => {
  it("every tone has a text, tint, hairline, dot and active-tile class in its own name", () => {
    for (const tone of TONES) {
      const c = TONE_CLASS[tone];
      expect(c.text).toBe(`text-tone-${tone}`);
      expect(c.soft).toBe(`bg-tone-${tone}/12`);
      expect(c.border).toBe(`border-tone-${tone}/35`);
      expect(c.dot).toBe(`bg-tone-${tone}`);
      expect(c.activeTile).toContain(`border-b-tone-${tone}`);
    }
  });

  it("a pill is tint, text and hairline together", () => {
    expect(tonePill("hot")).toBe("bg-tone-hot/12 text-tone-hot border-tone-hot/35");
  });

  it("pipeline stages: the Monday start is gold, a no-show is hot, paperwork is royal, unknown is slate", () => {
    expect(pipelineStageTone("New Lead")).toBe("cool");
    expect(pipelineStageTone("Interested")).toBe("warm");
    expect(pipelineStageTone("Expected Monday")).toBe("gold");
    expect(pipelineStageTone("Confirmed")).toBe("gold");
    expect(pipelineStageTone("Showed")).toBe("good");
    expect(pipelineStageTone("No Show")).toBe("hot");
    expect(pipelineStageTone("Contract Sent")).toBe("royal");
    expect(pipelineStageTone("Contracting In Progress")).toBe("royal");
    expect(pipelineStageTone("Active Agent")).toBe("good");
    expect(pipelineStageTone("Inactive/No Longer With Us")).toBe("slate");
    expect(pipelineStageTone(null)).toBe("slate");
    expect(pipelineStageTone("  active agent ")).toBe("good");
  });

  it("intent: hot is hot, warm is warm, cold is blue, unset is quiet", () => {
    expect(intentTone("hot")).toBe("hot");
    expect(intentTone("warm")).toBe("warm");
    expect(intentTone("cold")).toBe("cool");
    expect(intentTone("")).toBe("slate");
    expect(intentTone(undefined)).toBe("slate");
  });

  it("monday status and the hire ladder keep one tone per step", () => {
    expect(mondayTone("expected")).toBe("gold");
    expect(mondayTone("showed")).toBe("good");
    expect(mondayTone("no_show")).toBe("hot");
    expect(hireRungTone(0)).toBe("gold");
    expect(hireRungTone(1)).toBe("royal");
    expect(hireRungTone(2)).toBe("cool");
    expect(hireRungTone(3)).toBe("warm");
    expect(hireRungTone(4)).toBe("good");
    expect(hireRungTone(null)).toBe("slate");
    expect(teamStageTone("released_in_field")).toBe("good");
    expect(teamStageTone(null)).toBe("slate");
  });

  it("social command: a dead lane is hot, an alive lane is good, Sam's threads are gold", () => {
    expect(laneTone("alive")).toBe("good");
    expect(laneTone("dead")).toBe("hot");
    expect(laneTone("stale")).toBe("warm");
    expect(inboxBucketTone("hot")).toBe("hot");
    expect(inboxBucketTone("human_lane")).toBe("gold");
    expect(inboxBucketTone("waiting")).toBe("warm");
    expect(inboxBucketTone("booked")).toBe("cool");
    expect(inboxBucketTone("answered")).toBe("slate");
    expect(platformTone("instagram")).toBe("royal");
    expect(platformTone("youtube")).toBe("hot");
    expect(platformTone("untracked")).toBe("slate");
  });
});
