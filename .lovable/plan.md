

# Plan: Import Missing Production Data

## Summary

I will import all the deals you provided for agents with >$5,000 monthly production. This requires:
1. Creating missing agent profiles (Kaeden Vaughns, Josiah Darden, Alex Wordu)
2. Re-activating Aisha Kebbeh
3. Importing production data for all qualifying agents

---

## Parsed Deals to Import (125+ deals from your data)

I've extracted the following from your book of business data:

### Obiajulu Ifediora - 28 Deals (~$32,500 ALP)
| Date | ALP | Client |
|------|-----|--------|
| 2026-01-29 | $541.80 | Tina Hall |
| 2026-01-28 | $1,176.00 | lisa bednarz |
| 2026-01-27 | $1,430.52 | James Uranga |
| 2026-01-26 | $1,000.32 | Mary Hammond |
| 2026-01-23 | $949.44 | Janet Williams |
| 2026-01-22 | $1,163.40 | Laura Baskins |
| 2026-01-21 | $617.76 | Carol Johnston |
| 2026-01-20 | $1,489.20 | John Acosta |
| 2026-01-19 | $2,306.28 | Jeffery Troutt |
| 2026-01-16 | $1,325.76 | Geralyn Smith |
| 2026-01-15 | $2,315.88 | Yolanda Acros |
| 2026-01-14 | $900.00 | Sandra Wuorenma |
| 2026-01-13 | $2,900.40 | Timothy Uranga |
| 2026-01-12 | $563.76 | Brenda Bell |
| 2026-01-09 | $1,381.08 | Tammy Glasby |
| 2026-01-08 | $1,364.04 | Teresa White |
| 2026-01-07 | $976.08 | Lessie Morland |
| 2026-01-06 | $1,799.52 | Tammy Mcgee |
| 2026-01-05 | $3,076.08 | Sharlene Crisp |
| 2026-01-05 | $1,309.32 | Julie Scott |
| 2026-01-01 | $946.68 | Crystal Johnson |
| 2026-01-01 | $915.72 | Robin Wilson |

### Aisha Kebbeh - 15 Deals (~$17,200 ALP)
| Date | ALP |
|------|-----|
| 2026-01-29 | $2,160.00 |
| 2026-01-28 | $1,173.96 |
| 2026-01-27 | $1,685.28 |
| 2026-01-26 | $742.44 |
| 2026-01-23 | $720.00 |
| 2026-01-20 | $575.52, $1,143.24, $721.92, $903.96 |
| 2026-01-19 | $1,143.24 |
| 2026-01-08 | $2,498.88, $1,037.88 |
| 2026-01-07 | $1,263.72, $455.88 |
| 2026-01-03 | $567.00, $660.00, $1,538.52 |

### Kaeden Vaughns - 15 Deals (~$17,000 ALP) **NEW AGENT**
| Date | ALP |
|------|-----|
| 2026-01-28 | $566.76 |
| 2026-01-26 | $1,155.72 |
| 2026-01-24 | $502.68 |
| 2026-01-22 | $781.56 |
| 2026-01-19 | $1,138.44 |
| 2026-01-17 | $1,713.96, $1,660.56 |
| 2026-01-09 | $1,488.00, $1,260.00 |
| 2026-01-08 | $1,859.28 |
| 2026-01-07 | $961.92 |
| 2026-01-03 | $2,968.44 |
| 2026-01-02 | $697.92 |
| 2026-01-01 | $1,312.08, $1,744.56 |

### Josiah Darden - 7 Deals (~$8,700 ALP) **NEW AGENT**
| Date | ALP |
|------|-----|
| 2026-01-12 | $1,772.16 |
| 2026-01-07 | $576.12 |
| 2026-01-06 | $2,696.64, $767.76 |

### Alex Wordu - 4 Deals (~$5,200 ALP) **NEW AGENT**
| Date | ALP |
|------|-----|
| 2026-01-13 | $1,500.00 |
| 2026-01-08 | $240.00 |
| 2026-01-06 | $1,293.96 |
| 2026-01-05 | $484.32 |

---

## Implementation Steps

### Step 1: Create Missing Agent Profiles

Create new agents in the system:
- **Kaeden Vaughns** 
- **Josiah Darden**
- **Alex Wordu**
- **Richard Hall** (1 deal - $1,178.76)

### Step 2: Re-activate Aisha Kebbeh

Update her `is_deactivated` flag to `false` so she appears on leaderboards.

### Step 3: Import All Deals

Call the `import-production-data` edge function with the parsed deals:

```json
{
  "deals": [
    { "agent_name": "Obiajulu Ifediora", "annual_alp": 541.80, "posted_date": "2026-01-29" },
    { "agent_name": "Aisha Kebbeh", "annual_alp": 2160.00, "posted_date": "2026-01-29" },
    // ... all 125+ deals
  ]
}
```

### Step 4: Exclude from CRM (as requested)
- Codey Salazar - keep on dashboard, exclude from CRM
- Joseph Intwan - keep on dashboard, exclude from CRM

---

## Files to Modify

| File | Change |
|------|--------|
| Database | Create 4 new agent profiles |
| Database | Re-activate Aisha Kebbeh |
| Edge Function Call | Import 125+ deals via `import-production-data` |

---

## Expected Results

After import:

| Agent | January ALP | Deals |
|-------|-------------|-------|
| Codey Salazar | $39,602 | 35 |
| Obiajulu Ifediora | ~$32,500 | 28 |
| Moody Imran | $30,015 | 24 |
| Aisha Kebbeh | ~$17,200 | 15 |
| Kaeden Vaughns | ~$17,000 | 15 |
| Samuel James | $14,700 | 8 |
| Chukwudi Ifediora | $11,330 | 10 |
| Bryan Ross | $10,207 | 10 |
| Josiah Darden | ~$8,700 | 7 |
| Alex Wordu | ~$5,200 | 4 |

All dashboards will update live with real-time subscriptions.

