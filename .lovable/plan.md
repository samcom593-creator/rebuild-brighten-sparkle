

# Import 04/02 Production Data + Flag Fake Policy Numbers

## Unique Deals (9 deals, posted 04/02/2026)

| Agent | Client | ALP |
|-------|--------|-----|
| Marcos Castellanos | Patrick Evans | $1,775.88 |
| Wendell Funderburg | Karen Golliver | $832.56 |
| Chukwudi Ifediora | Rob Zane | $1,639.44 |
| Obiajulu Ifediora | Juan Acosta | $1,509.36 |
| Mahmod Imran | Candance Smith | $1,632.00 |
| Jacob Causer | Darlene Gagnon | $1,618.68 |
| Grey Bowman | Ernest Adams | $1,847.52 |
| Mahmod Imran | Anna Gomez | $1,692.00 |
| Wendell Funderburg | Brendon Tomlinson | $492.96 |

Note: The data was pasted twice — duplicates removed.

## Existing 04/02 Data Already in DB
- Dudley Bowman (mapped to Grey Bowman?): $1,847.52 / 1 deal — already there
- Chukwudi Ifediora: $1,639.44 / 1 deal — already there
- Wendell Funderburg: $1,325.16 / 0 deals — will be overwritten with $1,325.52 (2 deals)

## Agent Name Issue
**"Grey Bowman"** is not in the system. The closest match is **"Dudley Bowman"**. Need to add `"grey bowman": "dudley bowman"` to the alias map in the edge function before importing, OR confirm Grey Bowman is a new agent.

## Agents Using Fake/Placeholder Policy Numbers

| Policy # | Client | Agent |
|----------|--------|-------|
| `1234` | Patrick Evans | **Marcos Castellanos** |
| `0` | Karen Golliver | **Wendell Funderburg** |
| `1234` | Candance Smith | **Mahmod Imran** |
| `1234` | Darlene Gagnon | **Jacob Causer** |
| `1234` | Anna Gomez | **Mahmod Imran** |
| `000` | Brendon Tomlinson | **Wendell Funderburg** |

**Summary**: **Marcos Castellanos**, **Mahmod Imran** (2x), **Jacob Causer**, and **Wendell Funderburg** (2x) all submitted random/placeholder policy numbers instead of real ones.

## Implementation Steps

1. Add `"grey bowman": "dudley bowman"` alias to `import-production-data` edge function
2. Call the edge function with all 9 deals using `skip_existing: false`
3. This will aggregate per-agent-per-date and upsert (Mahmod gets 2 deals combined, Wendell gets 2 deals combined)

## Files Modified
- **`supabase/functions/import-production-data/index.ts`** — Add Grey Bowman alias

