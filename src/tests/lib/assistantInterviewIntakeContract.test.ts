import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("assistant interview intake release contract", () => {
  it("uses one durable request receipt across safe retries", () => {
    const form = read("src/pages/AssistantInterviewForm.tsx");
    const edge = read("supabase/functions/assistant-add-interview/index.ts");
    const migration = read("supabase/migrations/20260826082000_interview_intake_idempotency.sql");

    expect(form).toContain("pendingRequest.current.fingerprint !== fingerprint");
    expect(form).toContain("payload.request_id = pendingRequest.current.id");
    expect(edge).toContain('insErr?.code === "23505"');
    expect(edge).toContain("receipt: {");
    expect(edge).toContain("replayed,");
    expect(migration).toContain("manual_interview_entries_assistant_request_uniq");
  });

  it("requires a usable candidate identity and normalizes Instagram", () => {
    const form = read("src/pages/AssistantInterviewForm.tsx");
    const edge = read("supabase/functions/assistant-add-interview/index.ts");

    expect(form).toContain("instagramProfileLink(igHandle)");
    expect(form).toContain("Add a phone, email, or Instagram handle");
    expect(edge).toContain("function normalizeInstagram");
    expect(edge).toContain("Enter a valid Instagram handle");
    expect(edge).toContain("so the candidate can be identified");
  });

  it("separates inactive links from retryable connection failures", () => {
    const form = read("src/pages/AssistantInterviewForm.tsx");
    expect(form).toContain("tokenCheckFailed");
    expect(form).toContain("We couldn't check this link");
    expect(form).toContain("setCheckNonce((value) => value + 1)");
  });

  it("rejects invalid or past scheduling at both UI and server boundaries", () => {
    const form = read("src/pages/AssistantInterviewForm.tsx");
    const edge = read("supabase/functions/assistant-add-interview/index.ts");
    expect(form).toContain("minimumLocalDateTime()");
    expect(form).toContain("Pick a future date and time");
    expect(edge).toContain("Scheduled time must be in the future");
    expect(edge).toContain("Duration must be 5–240 minutes");
  });
});
