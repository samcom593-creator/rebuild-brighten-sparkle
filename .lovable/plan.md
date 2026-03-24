

# Auto-Assign All Unassigned Leads to Samuel James

## What Changes
1. **Database trigger** — Update `auto_assign_unassigned_application()` to set `assigned_agent_id` to Samuel James (`7c3c5581-3544-437f-bfe2-91391afb217d`) when a new application has no assigned agent.

2. **Backfill** — Update all existing unassigned applications (where `terminated_at IS NULL`) to Samuel James.

## Technical Details

### Migration SQL
```sql
CREATE OR REPLACE FUNCTION public.auto_assign_unassigned_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    NEW.assigned_agent_id := '7c3c5581-3544-437f-bfe2-91391afb217d';
  END IF;
  RETURN NEW;
END;
$$;
```

### Data backfill (via insert tool)
```sql
UPDATE applications
SET assigned_agent_id = '7c3c5581-3544-437f-bfe2-91391afb217d'
WHERE assigned_agent_id IS NULL AND terminated_at IS NULL;
```

### Files
- **Migration**: Update trigger function
- **Data fix**: Backfill existing NULLs
- No frontend code changes needed

