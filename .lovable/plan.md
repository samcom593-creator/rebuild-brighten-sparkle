

# Import New Production Data (03/23–03/24)

## New Deals to Import

### 03/24/2026 (1 deal)
| Agent | ALP | Deals |
|-------|-----|-------|
| Mahmod Imran | $2,016.00 | 1 |

### 03/23/2026 (10 deals)
| Agent | ALP | Deals |
|-------|-----|-------|
| Michael Kayembe | $3,664.68 | 3 |
| Jacob Causer | $2,376.00 | 2 |
| Obiajulu Ifediora | $2,689.92 | 1 |
| Aisha Kebbeh | $2,562.48 | 2 |
| Kaeden Vaughns | $1,454.28 | 1 |
| Mahmod Imran | $900.00 | 1 |

## Approach
Single call to `import-production-data` with all deals from the full dataset (01/17–03/24) using `skip_existing: false`. This adds the new 03/23–03/24 data and re-validates all historical dates in one pass. No code changes needed.

## Also re-imports 03/13–03/22
The pasted data includes deals from 03/13 onward with some entries that may have been updated (e.g., Joanne Scott now shows "Active" status). All will be overwritten with correct totals.

