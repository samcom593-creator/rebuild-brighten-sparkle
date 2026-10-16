import { describe, expect, it } from "vitest";
import { bookingGaps, checkNumber, clientAsks, draftDayLabel, formatDob, formatSsn, numberAsks, paymentLabel, routingChecksumOk, withNumberAsks } from "@/lib/soldCallPacket";

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

describe("checkNumber (numbers heard off the recording)", () => {
  it("passes a 9-digit SSN and says how a mis-heard one is off", () => {
    expect(checkNumber("ssn", "123-45-6789")).toEqual({ field: "ssn", digits: "123456789", ok: true, problem: null });
    expect(checkNumber("ssn", "1234567890")?.problem).toBe("10 digits, one more than an SSN has");
    expect(checkNumber("ssn", "12345678")?.problem).toBe("8 digits, one fewer than an SSN has");
    expect(checkNumber("ssn", "1234567")?.problem).toBe("7 digits, 2 fewer than an SSN has");
    expect(checkNumber("ssn", "000123456")?.problem).toBe("starts with 000, which no SSN does");
    expect(checkNumber("ssn", "123006789")?.problem).toBe("the middle two digits are 00, which no SSN has");
    expect(checkNumber("ssn", "123450000")?.problem).toBe("ends in 0000, which no SSN does");
    expect(checkNumber("ssn", "912345678")?.problem).toBe("starts with 9, which is a tax ID (ITIN), not an SSN");
    expect(checkNumber("ssn", "1")?.problem).toBe("1 digit, 8 fewer than an SSN has");
    expect(checkNumber("ssn", "")).toBeNull();
    expect(checkNumber("ssn", null)).toBeNull();
  });

  it("checks a routing number's length and the bank's check digit", () => {
    expect(routingChecksumOk("111000025")).toBe(true);
    expect(routingChecksumOk("111000026")).toBe(false);
    expect(checkNumber("bank_routing", "111000025")?.ok).toBe(true);
    expect(checkNumber("bank_routing", "111000026")?.problem).toBe("fails the bank's check digit, so a digit is wrong or two are swapped");
    expect(checkNumber("bank_routing", "503000196")?.problem).toBe("starts with 50, which no routing number does");
    expect(checkNumber("bank_routing", "000000000")?.problem).toBe("all zeros, which no routing number is");
    expect(checkNumber("bank_routing", "1110000255")?.problem).toBe("10 digits, and a routing number has 9");
  });

  it("holds a bank account number to 4 to 17 digits", () => {
    expect(checkNumber("bank_account", "000123456789")?.ok).toBe(true);
    expect(checkNumber("bank_account", "123")?.problem).toBe("3 digits, too short for a bank account");
    expect(checkNumber("bank_account", "1234567890123456789")?.problem).toBe("19 digits, more than any US bank account has (17 at most)");
  });

  it("turns each number that cannot be right into what to confirm with the client", () => {
    expect(numberAsks([checkNumber("ssn", "1234567890"), checkNumber("bank_routing", "111000025"), null, checkNumber("bank_routing", "111000026")]))
      .toEqual([
        "Confirm the SSN: 10 digits, one more than an SSN has",
        "Confirm the routing number: fails the bank's check digit, so a digit is wrong or two are swapped",
      ]);
  });

  it("asks to confirm a mis-heard number instead of asking for it from scratch", () => {
    const asks = clientAsks(["ssn", "client_zip", "bank_routing"], true);
    expect(asks).toEqual(["Social Security number", "Home address", "Routing number"]);
    expect(withNumberAsks(asks, [checkNumber("ssn", "1234567890"), checkNumber("bank_routing", "111000025")]))
      .toEqual(["Home address", "Routing number", "Confirm the SSN: 10 digits, one more than an SSN has"]);
  });
});
