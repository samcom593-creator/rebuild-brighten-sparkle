import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bookingBaseFor,
  classifyProviderError,
  isRetryable,
  normalizeName,
  parseStageKey,
  renderTemplate,
  subjectTemplateFor,
} from "./render.ts";

Deno.test("parseStageKey accepts only the v2 family with a variant", () => {
  assertEquals(parseStageKey("reactivation_v2_cold_t1_a"), { track: "cold", touch: 1, variant: "a" });
  assertEquals(parseStageKey("reactivation_v2_course_done_t3_b"), { track: "course_done", touch: 3, variant: "b" });
  assertEquals(parseStageKey("reactivation_v2_cold_t1"), null);
  assertEquals(parseStageKey("reactivation_v2_cold_t4_a"), null);
  assertEquals(parseStageKey("reactivation_2026_11"), null);
  assertEquals(parseStageKey("reactivation_v2_cold_t1_a; drop table x"), null);
});

Deno.test("bookingBaseFor sends each track to the call that fits it", () => {
  const links = { questions: "Q", licensing: "L", licensed: "S" };
  assertEquals(bookingBaseFor("cold", links), "Q");
  assertEquals(bookingBaseFor("in_course", links), "L");
  assertEquals(bookingBaseFor("course_done", links), "L");
  assertEquals(bookingBaseFor("pending", links), "S");
  assertEquals(bookingBaseFor("licensed", links), "S");
  assertEquals(bookingBaseFor("cold", { ...links, questions: null }), null);
});

Deno.test("normalizeName fixes shouting and lowercase, keeps deliberate mixed case", () => {
  assertEquals(normalizeName("JOHN"), "John");
  assertEquals(normalizeName("john"), "John");
  assertEquals(normalizeName("mary-jane"), "Mary-Jane");
  assertEquals(normalizeName("O'NEIL"), "O'Neil");
  assertEquals(normalizeName("DeShawn"), "DeShawn");
  assertEquals(normalizeName("McKenzie"), "McKenzie");
  assertEquals(normalizeName("  ana   maria "), "Ana Maria");
  assertEquals(normalizeName(""), "");
  assertEquals(normalizeName(null), "");
});

Deno.test("subjectTemplateFor drops the vocative when there is no first name", () => {
  assertEquals(subjectTemplateFor("{{first_name}}, still looking for an agency?", false), "Still looking for an agency?");
  assertEquals(subjectTemplateFor("{{first_name}}, still looking for an agency?", true), "{{first_name}}, still looking for an agency?");
  assertEquals(subjectTemplateFor("Licensed and still looking?", false), "Licensed and still looking?");
});

Deno.test("renderTemplate reports missing keys instead of rendering blanks, escapes html only", () => {
  const vars = { first_name: "Ana <b>", booking_url: "https://x.test/a?b=1&c=2" };
  const html = renderTemplate("<p>Hey {{first_name}}</p><a href=\"{{booking_url}}\">x</a>", vars, "html");
  assertEquals(html.missing, []);
  assertEquals(html.text, "<p>Hey Ana &lt;b&gt;</p><a href=\"https://x.test/a?b=1&amp;c=2\">x</a>");
  const plain = renderTemplate("{{first_name}},\n still", vars, "plain");
  assertEquals(plain.text, "Ana <b>, still");
  const text = renderTemplate("Hey {{first_name}},\n\nBook: {{booking_url}}", vars, "text");
  assertEquals(text.text, "Hey Ana <b>,\n\nBook: https://x.test/a?b=1&c=2");
  assertEquals(renderTemplate("{{nope}} hi", vars, "plain").missing, ["nope"]);
});

Deno.test("classifyProviderError stops a person only for a refusal about that person", () => {
  // per person: never mail this address again
  assertEquals(classifyProviderError({ name: "suppressed_recipient", message: "on Resend's suppression list" }).scope, "person");
  assertEquals(classifyProviderError({ name: "non_routable_recipient", message: "domain cannot receive mail" }).scope, "person");
  const badTo = classifyProviderError({
    name: "validation_error",
    message: "Invalid `to` field. The email address needs to follow the `email@example.com` format.",
  });
  assertEquals([badTo.scope, badTo.retryable], ["person", false]);
  // the account: release untouched, open the breaker. A quota is never "retry in 15 minutes".
  const quota = classifyProviderError({ name: "monthly_quota_exceeded", message: "You have reached your monthly quota" });
  assertEquals([quota.scope, quota.retryable], ["account", false]);
  const daily = classifyProviderError({ name: "daily_quota_exceeded", message: "Too many requests: daily quota" });
  assertEquals([daily.scope, daily.retryable], ["account", false]);
  const rate = classifyProviderError({ name: "rate_limit_exceeded", message: "Too many requests. 10 per second." });
  assertEquals([rate.scope, rate.retryable], ["account", true]);
  assertEquals(classifyProviderError({ name: "invalid_api_Key", message: "API key is invalid" }).scope, "account");
  assertEquals(classifyProviderError({ name: "invalid_from_address", message: "Invalid `from` field" }).scope, "account");
  // shares the validation_error name, but it is about the sending domain, not the recipient
  const unverified = classifyProviderError({
    name: "validation_error",
    message: "You can only send testing emails to your own email address. To send to other recipients, verify a domain.",
  });
  assertEquals(unverified.scope, "account");
  assertEquals(classifyProviderError({ name: "application_error", message: "Something went wrong" }).retryable, true);
  // nothing trustworthy came back: maybe sent, so hold, never resend blind
  assertEquals(classifyProviderError(null).scope, "unknown");
  assertEquals(classifyProviderError({}).scope, "unknown");
});

Deno.test("isRetryable separates throttling from permanent refusals", () => {
  assertEquals(isRetryable("Too many requests. You can only make 10 requests per second."), true);
  assertEquals(isRetryable("upstream returned 503"), true);
  assertEquals(isRetryable("recipient is on Resend's suppression list (hard bounce)"), false);
  assertEquals(isRetryable("Invalid `to` field"), false);
});
