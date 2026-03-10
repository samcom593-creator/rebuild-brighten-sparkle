

# Import 31 Carrier Deals into Production Numbers

## What
Import the 31 deals you pasted from carrier records into the production database. The existing import system uses **SET (upsert) logic** — it replaces the total for each agent+date combo rather than adding on top. This prevents any doubling/overlap with manually logged numbers.

## Deal Summary by Agent & Date

| Agent | Date | Deals | ALP |
|---|---|---|---|
| Aisha Kebbeh | 03/09 | 2 | $2,584.08 |
| Kaeden Vaughns | 03/09 | 2 | $2,586.48 |
| Kaeden Vaughns | 03/08 | 1 | $1,583.88 |
| Samuel James | 03/09 | 2 | $7,507.44 |
| Obiajulu Ifediora | 03/09 | 2 | $2,000.52 |
| Obiajulu Ifediora | 03/06 | 1 | $2,143.80 |
| Obiajulu Ifediora | 03/05 | 1 | $2,313.84 |
| Obiajulu Ifediora | 03/04 | 1 | $1,168.08 |
| Obiajulu Ifediora | 03/03 | 1 | $1,583.64 |
| Obiajulu Ifediora | 03/02 | 2 | $3,677.76 |
| Chukwudi Ifediora | 03/09 | 1 | $1,928.28 |
| Chukwudi Ifediora | 03/06 | 1 | $2,291.64 |
| Chukwudi Ifediora | 03/04 | 1 | $841.32 |
| Chukwudi Ifediora | 03/02 | 1 | $776.76 |
| Chukwudi Ifediora | 03/01 | 1 | $1,512.48 |
| Brennan Barker | 03/09 | 1 | $935.16 |
| Brennan Barker | 03/06 | 1 | $1,515.00 |
| Brennan Barker | 03/03 | 1 | $1,702.08 |
| Brennan Barker | 03/02 | 1 | $883.92 |
| Mahmod Imran | 03/09 | 1 | $1,164.00 |
| Mahmod Imran | 03/06 | 1 | $1,308.00 |
| Michael Kayembe | 03/05 | 1 | $1,706.28 |
| Landon Boyd | 03/04 | 1 | $408.00 |
| Jacob Causer | 03/04 | 1 | $2,051.76 |
| Loren Lail | 03/03 | 2 | $1,652.16 |

**Total: 31 deals across 10 agents, 8 dates**

## How
Call the `import-production-data` edge function with all 31 deals. The function:
1. Maps agent names to agent IDs (case-insensitive)
2. Aggregates deals by agent+date
3. Upserts (SET, not ADD) into `daily_production` — **no overlap/doubling**
4. Reports any unmatched agent names

