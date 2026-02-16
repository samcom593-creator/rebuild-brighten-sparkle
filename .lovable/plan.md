

# Import 20 Production Deals into the System

## Overview
Import the 20 deals you provided into the daily production tracking system using the existing `import-production-data` backend function.

## Agent Name Matching
All agent names from your list match database records **except one**:

| Deal Agent Name | Database Name | Status |
|---|---|---|
| Moody Imran | Moody Imran | Match |
| Kaeden Vaughns | Kaeden Vaughns | Match |
| Aisha Kebbeh | Aisha Kebbeh | Match |
| Chukwudi Ifediora | Chukwudi Ifediora | Match |
| Obiajulu Ifediora | Obiajulu Ifediora | Match |
| Michael Kayembe | Michael Kayembe | Match |
| Leslie Patino Galeana | Leslie | Mismatch -- will fix |

## Deals to Import (20 total)

Grouped by agent and posted date, using the Annual ALP column:

- **Moody Imran** (4 deals): $2,112 (Feb 15), $1,284 + $1,404 (Feb 10), $1,236 (Feb 9)
- **Kaeden Vaughns** (4 deals): $3,080.40 (Feb 13), $533.28 (Feb 10), $1,155.72 + $865.80 (Feb 9)
- **Aisha Kebbeh** (3 deals): $755.88 (Feb 13), $1,019.40 (Feb 12), $560.40 (Feb 9)
- **Chukwudi Ifediora** (4 deals): $932.16 + $1,172.76 (Feb 12), $1,295.76 (Feb 11), $1,928.40 (Feb 9)
- **Obiajulu Ifediora** (3 deals): $3,380.52 (Feb 11), $1,303.08 + $1,393.92 (Feb 9)
- **Michael Kayembe** (1 deal): $451.80 (Feb 10)
- **Leslie Patino Galeana** (1 deal): $1,645.92 (Feb 9)

## Steps

### 1. Fix Leslie's Profile Name
Update the profile name from "Leslie" to "Leslie Patino Galeana" so the import function can match her.

### 2. Call the Import Function
Invoke the `import-production-data` backend function with all 20 deals formatted as:
```text
{ agent_name, annual_alp, posted_date (YYYY-MM-DD) }
```

The function will:
- Match each deal to an agent by name
- Aggregate deals by agent + date (e.g., Chukwudi's two Feb 12 deals become one record with combined ALP)
- Add to any existing daily_production records for that date (won't overwrite)
- Report any failures

### 3. Verify Results
Confirm all 20 deals were imported successfully and check the leaderboard/dashboard reflects the updated numbers.

## Technical Details
- **File modified**: None (profile name fix via database update)
- **Function used**: `import-production-data` edge function (already deployed)
- **No code changes needed** -- this is a data operation only

