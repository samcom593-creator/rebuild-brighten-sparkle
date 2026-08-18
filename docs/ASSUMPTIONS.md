# APEX OS — Assumptions

Per directive §7: where information was missing but did not block safe
implementation, the least risky assumption was taken and recorded here.

| ID | Assumption | Basis | Risk if wrong | Where centralized |
|---|---|---|---|---|
| A-001 | The existing single organization becomes the first tenant ("APEX Financial") rather than being migrated away | 335 tables of live production data, all unscoped | Low — a default tenant is required regardless | tenant seed |
| A-002 | Platform brand = "APEX", product = "APEX OS", co-brand string = "Powered by APEX" | Stated in directive §1 | Low | `src/config/brand.ts` |
| A-003 | Insurance features remain enabled for the first tenant and become a feature-flagged vertical module, not a deletion | §16.11 says preserve behind a flag; live production data depends on them | High if deleted — this is the operating business | entitlements |
| A-004 | Existing `admin` role maps to *agency owner* (tenant plane), and a new APEX super-admin role is introduced above it | `admin` today governs one org only | Medium — mis-mapping over-privileges | role migration |
| A-005 | No third-party integration is added without official API/OAuth; Monday.com, Systeme.io, GoHighLevel, BotPenguin are treated as not-integrated (no code references found) | §5 forbids inventing endpoints | Low | integration registry |
| A-006 | Demo data, when created, lives in a dedicated demo tenant labeled DEMO DATA and never mixes with production | §4 | High if violated | demo tenant |
| A-007 | Skool membership is maintained manually (no public API); it is an input, not a live integration | verified — loaded via export/screenshot | Low | workforce docs |
