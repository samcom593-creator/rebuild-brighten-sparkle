

# Import Full Production Data (01/13 – 03/25) with New Agents

## What's New
This dataset includes **03/25 deals** (9 new deals) plus corrections/additions across 03/24 back to 01/13. It also introduces several agents not previously imported:

### New agents in dataset (not in previous imports)
- **Dalton Rowland** — ~40+ deals across many dates
- **Alyjah Rowland** — ~10 deals
- **Christopher Avent** — 1 deal (02/20)
- **Loren Lail** — 2 deals
- **Codey Salazar** — ~6 deals
- **Joseph Sebasco** — ~5 deals
- **Richard Hall** — 1 deal
- **Bryan Ross** — ~10 deals
- **Leslie Patino Galeana** — 1 deal
- **Samuel Lugo Puga** — ~3 deals
- **Landon Boyd** — ~3 deals

These agents must already exist in the `agents` table with matching profile names, or they'll be reported as "missing" by the import function.

### 03/25 deals (new)
| Agent | ALP | Deals |
|-------|-----|-------|
| Chukwudi Ifediora | $1,631.64 | 1 |
| Michael Kayembe | $1,728.36 | 2 |
| Aisha Kebbeh | $2,885.40 | 3 |
| Obiajulu Ifediora | $1,487.88 | 2 |
| Mahmod Imran | $720.00 | 1 |

### 03/24 additions (not in prior import)
| Agent | ALP | Deals |
|-------|-----|-------|
| Samuel James | $2,292.00 | 2 |
| Dalton Rowland | $2,552.40 | 1 |

## Approach
1. Single call to `import-production-data` with the **full dataset** (~300+ deals) using `skip_existing: false` to overwrite all dates with correct totals
2. The function will report any missing agents — if new agents (Dalton Rowland, Alyjah Rowland, etc.) aren't in the system yet, they'll appear in the `missing_agents` list
3. If agents are missing, we'll need to either add them first or add name aliases to the import function

## Pre-check needed
Before importing, verify which of the new agents exist in the database. If they don't, we need to:
- Either create agent records for them first (via `add-agent` edge function)
- Or add aliases to the `NAME_ALIASES` map if their profile names differ

## No code changes required
Data-only operation via edge function invocation.

