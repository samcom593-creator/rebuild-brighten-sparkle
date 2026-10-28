import { describe, expect, it } from "vitest";

import {
  INVITE_NOTE_LIMIT,
  contractingBlock,
  contractingInfoFor,
  contractingLine,
  decodeInviteNote,
  displayPhone,
  encodeInviteNote,
  freeNoteRoom,
  splitName,
} from "@/lib/inviteContractingInfo";

const FIELDS = { firstName: "Mary Ann", lastName: "Smith", phone: "(256) 975-6155", npn: "12 345 678" };

describe("invite contracting info", () => {
  it("round-trips the four fields and the free note through the internal note", () => {
    const note = encodeInviteNote(FIELDS, "Met at the Tuesday seminar");
    expect(note).toBe("Contracting: First=Mary Ann; Last=Smith; Phone=2569756155; NPN=12345678\nMet at the Tuesday seminar");
    expect(decodeInviteNote(note)).toEqual({
      fields: { firstName: "Mary Ann", lastName: "Smith", phone: "2569756155", npn: "12345678" },
      note: "Met at the Tuesday seminar",
    });
  });

  it("never exceeds the server's 200-character note limit", () => {
    const long = "x".repeat(400);
    const note = encodeInviteNote(FIELDS, long) ?? "";
    expect(note.length).toBe(INVITE_NOTE_LIMIT);
    expect(freeNoteRoom(FIELDS)).toBe(INVITE_NOTE_LIMIT - contractingLine(FIELDS).length - 1);
    expect(decodeInviteNote(note).fields.npn).toBe("12345678");
  });

  it("separators typed into a name cannot corrupt the other fields", () => {
    const note = encodeInviteNote({ firstName: "A;NPN=999", lastName: "B=C", phone: "", npn: "123456" }, "");
    expect(decodeInviteNote(note).fields).toEqual({ firstName: "A NPN 999", lastName: "B C", npn: "123456" });
  });

  it("an empty form sends no note, and a plain note decodes as just a note", () => {
    expect(encodeInviteNote({ firstName: "", lastName: "", phone: "", npn: "" }, "  ")).toBeNull();
    expect(decodeInviteNote("Call after 5pm")).toEqual({ fields: {}, note: "Call after 5pm" });
    expect(decodeInviteNote(null)).toEqual({ fields: {}, note: "" });
  });

  it("an older invitation falls back to splitting the stored name; the last word is the last name", () => {
    expect(splitName("Mary Ann Smith")).toEqual({ firstName: "Mary Ann", lastName: "Smith" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(contractingInfoFor({ recipient_name: "Jo Carter", recipient_email: "jo@example.test", notes: "Old note" })).toEqual({
      firstName: "Jo", lastName: "Carter", email: "jo@example.test", phone: "", npn: "",
    });
  });

  it("prefers the typed fields over the stored name, and Copy all skips blanks", () => {
    const info = contractingInfoFor({ recipient_name: "Mary Ann Smith", recipient_email: "mary@example.test", notes: encodeInviteNote(FIELDS, "") });
    expect(info).toEqual({ firstName: "Mary Ann", lastName: "Smith", email: "mary@example.test", phone: "2569756155", npn: "12345678" });
    expect(contractingBlock(info)).toBe("First name: Mary Ann\nLast name: Smith\nEmail: mary@example.test\nPhone: (256) 975-6155\nNPN: 12345678");
    expect(contractingBlock({ ...info, phone: "", npn: "" })).toBe("First name: Mary Ann\nLast name: Smith\nEmail: mary@example.test");
    expect(displayPhone("12569756155")).toBe("(256) 975-6155");
  });
});
