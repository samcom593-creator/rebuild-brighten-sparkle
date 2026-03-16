

# Add Copy Phone Button in Call Center + Rename "Pages" → "Hours Called"

## Changes

### 1. Add Copy-to-Clipboard button next to phone number in Call Center
In `src/components/callcenter/CallCenterLeadCard.tsx` (lines 311-347), add a "Copy" button inside the phone row. When tapped, it copies the raw phone number to clipboard and shows a toast confirmation. The existing "Tap to call" / "CALL NOW" behavior stays — the copy button sits beside it.

Also apply the same to `src/components/dashboard/CallModeInterface.tsx` (lines 215-228) where phone is displayed in call mode.

### 2. Rename "Pages" → "Hours Called" in 4 files
| File | Line | Change |
|------|------|--------|
| `CompactProductionEntry.tsx` | 266 | `"Pages"` → `"Hours Called"` |
| `ProductionEntry.tsx` | 383 | `"Pages"` → `"Hours Called"` |
| `LogNumbers.tsx` | 311 | `"Pages"` → `"Hours Called"` |
| `LeaderboardTabs.tsx` | 588, 692 | `Pages` → `Hours Called` in column header and comment |

No database changes needed.

