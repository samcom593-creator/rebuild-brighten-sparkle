import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACTING_PROFILE_SUBJECT, CONTRACTING_PROFILE_URL as EDGE_URL, CONTRACTING_TEAM_NAME, NOT_CONTRACTED_YET,
  contractingProfileEmailHtml, contractingProfileEmailText,
} from "../../../supabase/functions/_shared/contracting-profile";
import { CONTRACTING_PROFILE_URL as APP_URL } from "@/lib/contractingLinks";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

// Fragments are joined at run time so this file does not itself contain the phrases it forbids.
const BANNED: Array<[string, RegExp]> = [
  ["a named outside contracting contact", new RegExp(["john", "way"].join("\\s+"), "i")],
  ["the private contracting channel", new RegExp(["contracting", "(discord|desk|channel)"].join("\\s+"), "i")],
  ["a spreadsheet step", /spreadsheet|ethos sheet/i],
  ["the retired intake link", /start-contracting/i],
  ["the retired checklist", /first contract/i],
];

describe("the contracting profile email", () => {
  it("has the exact subject", () => {
    expect(CONTRACTING_PROFILE_SUBJECT).toBe("Complete your contracting profile");
  });

  it("has the exact body: the five fields, the four carriers in order, the link, the not-contracted-yet sentence and the team sign-off", () => {
    expect(contractingProfileEmailText("Ana")).toBe([
      "Hi Ana,",
      "",
      "Please complete your contracting profile with your NPN number, first name, last name, email address, and resident state.",
      "",
      `Complete contracting profile: ${EDGE_URL}`,
      "",
      "Our team will use this information to coordinate the carrier portal steps and track Combine, AFLAC, GTO, and Ethos on your profile.",
      "",
      "Submitting your information does not mean carrier contracting is complete.",
      "",
      "Thank you,",
      "The Galaxy Team",
    ].join("\n"));
  });

  it("uses one link, and it is the same link the app uses", () => {
    expect(EDGE_URL).toBe(APP_URL);
    expect(new URL(EDGE_URL).pathname).toBe("/dashboard/contracting-profile");
  });

  it("the HTML version carries the same words, one link with the exact label, and escapes the name", () => {
    const html = contractingProfileEmailHtml('<b>Ana</b> & "Co"');
    expect(html).toContain("Hi &lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Co&quot;,");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(`<a href="${EDGE_URL}">Complete contracting profile</a>`);
    expect(html).toContain(NOT_CONTRACTED_YET);
    expect(html).toContain(CONTRACTING_TEAM_NAME);
    expect(html).toContain("NPN number, first name, last name, email address, and resident state");
  });

  it("falls back to 'there' when there is no first name", () => {
    expect(contractingProfileEmailText("   ")).toMatch(/^Hi there,/);
  });

  it("never says contracting is done, sent or automatic", () => {
    const body = contractingProfileEmailText("Ana");
    expect(body).not.toMatch(/automatically|submitted to|we have contacted|you are contracted|dispatch/i);
  });

  it("contains none of the retired instructions", () => {
    const body = `${contractingProfileEmailText("Ana")}\n${contractingProfileEmailHtml("Ana")}`;
    for (const [what, re] of BANNED) expect(body, what).not.toMatch(re);
  });
});

describe("the retired contracting instructions stay out of what people read", () => {
  const FILES = [
    "supabase/functions/add-agent/index.ts",
    "supabase/functions/consume-invite-token/index.ts",
    "supabase/functions/welcome-new-agent/index.ts",
    "supabase/functions/send-licensing-instructions/index.ts",
    "supabase/functions/telegram-webhook/index.ts",
    "src/components/dashboard/AgentOnboardingStepper.tsx",
    "src/components/dashboard/FirstLoginGuide.tsx",
    "src/components/onboarding/ApplicantHome.tsx",
    "src/components/contracting/ContractingReadinessCard.tsx",
    "src/pages/HelpCenter.tsx",
    "src/pages/ContractingProfile.tsx",
  ];
  for (const f of FILES) {
    it(`${f} has no retired contracting instruction`, () => {
      const src = read(f);
      for (const [what, re] of BANNED) expect(src, `${f}: ${what}`).not.toMatch(re);
    });
  }

  it("the old intake address only ever redirects, and nothing else in the app links to it", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/start-contracting" element={<Navigate to="/dashboard/contracting-profile" replace />}');
    expect(app).not.toMatch(/import\(["']\.\/pages\/StartContracting["']\)/);
    expect(fs.existsSync(path.join(root, "src/pages/StartContracting.tsx"))).toBe(false);
  });

  it("the signed-in contracting profile is behind sign-in and the Contracts front page does not ask staff for a name or email", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/path="\/dashboard\/contracting-profile" element=\{<ProtectedRoute><ContractingProfile \/><\/ProtectedRoute>\}/);
    const contracts = read("src/pages/CarrierContracts.tsx");
    const card = contracts.slice(contracts.indexOf("function ContractingLinkCard"), contracts.indexOf("function StartContractingCard"));
    expect(card).not.toMatch(/<Input|<input|type="email"|first_name|last_name/);
    expect(card).toContain("You type nothing");
  });
});
