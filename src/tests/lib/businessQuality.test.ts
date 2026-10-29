import { describe, expect, it } from "vitest";
import { bookedPct, saleVerdictLabel, saleVerdictTone, salesAtRisk } from "@/lib/businessQuality";

describe("business quality", () => {
  it("names every verdict in plain words, and falls back for a new one", () => {
    expect(saleVerdictLabel("not_in_book")).toBe("Sold, never booked");
    expect(saleVerdictLabel("fell_off")).toBe("Booked, then fell off");
    expect(saleVerdictLabel("ok")).toBe("Booked and holding");
    expect(saleVerdictLabel("brand_new")).toBe("brand new");
    expect(saleVerdictTone("brand_new")).toBe("text-muted-foreground");
  });
  it("counts the sales that still need work", () => {
    expect(salesAtRisk({ not_in_book: 3, fell_off: 2, lapsing: 1 })).toBe(6);
  });
  it("rounds the booked share and has none for a seat with no sales", () => {
    expect(bookedPct({ sold_calls: 3, in_book: 2 })).toBe(67);
    expect(bookedPct({ sold_calls: 0, in_book: 0 })).toBeNull();
  });
});
