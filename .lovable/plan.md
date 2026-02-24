

# Reassign Charles Reese & Keilani Sinclair to KJ Vaughns

## Data Update (no code changes needed)

Two SQL updates via the edge function or direct database operation:

```sql
UPDATE applications 
SET assigned_agent_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'
WHERE id IN (
  '538823ac-50ab-43c1-a5bc-b7720abf0cef',  -- Charles Reese
  '5e1aa42c-9cb5-4c0b-a3ab-d69e078c5360'   -- Keilani Sinclair
);
```

This moves both leads from Samuel James (admin) to KJ Vaughns. They will immediately appear in KJ's pipeline due to existing RLS policies.

**No frontend or backend code changes required** -- this is purely a data reassignment.

