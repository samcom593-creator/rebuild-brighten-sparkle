import { describe, expect, it } from "vitest";
import { productionRunRate } from "@/lib/productionRunRate";

describe("completed-day production run rate", () => {
  it("uses complete-day production and the same complete-day denominator", () => {
    expect(productionRunRate({ mtd_ap: 13000, completed_ap: 12000, completed_active_days: 8 }, 12, 30)).toMatchObject({ amount: 30000, dailyAP: 1000 });
  });
  it("does not present actual production as a projection when history is insufficient", () => {
    expect(productionRunRate({ mtd_ap: 4000, completed_ap: 1000, completed_active_days: 1 }, 10, 30).amount).toBeNull();
    expect(productionRunRate({ mtd_ap: 4000 }, 10, 30).amount).toBeNull();
    expect(productionRunRate({ mtd_ap: 0, completed_ap: 0, completed_active_days: 0 }, 0, 30).amount).toBeNull();
  });
  it("does not let today's big sale produce a total below already-posted ALP", () => {
    expect(productionRunRate({ mtd_ap: 45000, completed_ap: 3000, completed_active_days: 3 }, 20, 30).amount).toBe(45000);
  });
  it("rejects inconsistent, future or invalid source bounds", () => {
    expect(productionRunRate({ mtd_ap: 3000, completed_ap: 4000, completed_active_days: 3 }, 3, 30).amount).toBeNull();
    expect(productionRunRate({ mtd_ap: 3000, completed_ap: 3000, completed_active_days: 4 }, 3, 30).amount).toBeNull();
    expect(productionRunRate({ mtd_ap: 3000, completed_ap: 3000, completed_active_days: 3 }, 30, 30).amount).toBeNull();
  });
});
