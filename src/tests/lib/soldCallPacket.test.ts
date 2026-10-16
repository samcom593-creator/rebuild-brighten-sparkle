import { describe, expect, it } from "vitest";
import { bookingGaps, clientAsks, draftDayLabel, formatDob, formatSsn, paymentLabel } from "@/lib/soldCallPacket";

describe("clientAsks", () => {
  it("never asks the client for a policy number, which the carrier assigns", () => {
    expect(clientAsks(["policy_number"], true)).toEqual([]);
  });

  it("drops phone when the dialer already has the number the agent called", () => {
    expect(clientAsks(["client_phone", "client_dob"], true)).toEqual(["Date of birth"]);
    expect(clientAsks(["client_phone"], false)).toEqual(["Phone number"]);
  });

  it("turns raw keys into the questions a caller asks, once each", () => {
    expect(clientAsks(["client_city", "client_zip", "bank_routing", "beneficiaries[0].dob", "beneficiary_dob"], true))
      .toEqual(["Home address", "Routing number", "Beneficiary date of birth"]);
  });

  it("reads every key shape the transcriber writes today", () => {
    expect(clientAsks(["beneficiaries.0.dob", "beneficiaries[].pct", "beneficiary_names"], true))
      .toEqual(["Beneficiary date of birth", "Beneficiary percentages", "Beneficiary name"]);
    expect(clientAsks(["client_phone_complete", "tobacco_status", "health_notes", "client_weight"], true))
      .toEqual(["Tobacco use", "Health questions", "Height and weight"]);
  });

  it("names a second person on the application by first name", () => {
    expect(clientAsks(["candace_dob", "carol_ssn", "spouse_dob"], true))
      .toEqual(["Candace's date of birth", "Carol's Social Security number", "Spouse's date of birth"]);
  });

  it("keeps an unknown key readable instead of hiding it", () => {
    expect(clientAsks(["spouse_name"], true)).toEqual(["spouse name"]);
  });
});

describe("bookingGaps", () => {
  it("lists policy facts the call never stated, separately from client asks", () => {
    expect(bookingGaps(["carrier", "policy_number", "monthly_premium", "client_dob"])).toEqual(["Carrier", "Monthly premium"]);
    expect(bookingGaps(["carrier_confirmation", "monthly_premium_amount_uncertain", "policy_start_date"])).toEqual(["Carrier", "Monthly premium", "Policy start date"]);
    expect(clientAsks(["carrier_name", "policy_start_date"], true)).toEqual([]);
  });
});

describe("formatters", () => {
  it("formats a 9-digit SSN and leaves anything else exactly as transcribed", () => {
    expect(formatSsn("123456789")).toBe("123-45-6789");
    expect(formatSsn("123-45-6789")).toBe("123-45-6789");
    expect(formatSsn("12345")).toBe("12345");
    expect(formatSsn("")).toBeNull();
  });

  it("names the payment method and hides unknown", () => {
    expect(paymentLabel("checking")).toBe("Checking account");
    expect(paymentLabel("direct_express")).toBe("Direct Express card");
    expect(paymentLabel("unknown")).toBeNull();
  });

  it("reads a numeric draft day as a day of the month and keeps spoken text", () => {
    expect(draftDayLabel("1")).toBe("1st of the month");
    expect(draftDayLabel("22")).toBe("22nd of the month");
    expect(draftDayLabel("11")).toBe("11th of the month");
    expect(draftDayLabel("fourth Wednesday")).toBe("fourth Wednesday");
  });

  it("shows an ISO date of birth the way an application asks for it", () => {
    expect(formatDob("1958-03-07")).toBe("03/07/1958");
    expect(formatDob("March 1958")).toBe("March 1958");
  });
});
