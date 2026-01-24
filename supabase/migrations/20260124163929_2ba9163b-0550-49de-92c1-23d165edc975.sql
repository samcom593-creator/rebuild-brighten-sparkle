-- Add new attendance type for daily sales tracking
ALTER TYPE attendance_type ADD VALUE 'daily_sale';

-- Allow managers to insert profiles for new team members
CREATE POLICY "Managers can insert team profiles"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
);

-- Allow managers to insert agents into their team
CREATE POLICY "Managers can insert team agents"
ON agents FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role) 
  AND invited_by_manager_id = current_agent_id()
);