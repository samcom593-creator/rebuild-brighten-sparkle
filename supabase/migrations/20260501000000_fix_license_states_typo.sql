-- Fix: bot_alert_newly_licensed referenced NEW.license_states (typo)
-- but the actual column is licensed_states. Every UPDATE that hit
-- license_progress='licensed' or license_status='licensed' raised
-- "record new has no field license_states" → entire admin/manager
-- mark-licensed UPDATE rolled back → user saw "Failed to update progress".
-- Sam 2026-05-01: "still won't let me add them as licensed".
CREATE OR REPLACE FUNCTION public.bot_alert_newly_licensed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.license_progress IS DISTINCT FROM NEW.license_progress
      AND NEW.license_progress = 'licensed')
     OR (OLD.license_status IS DISTINCT FROM NEW.license_status
         AND NEW.license_status = 'licensed')
  THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, action_link, channels)
    VALUES (
      'trigger', 'applicant_newly_licensed', 'celebrate',
      format('🎓 %s %s passed their license exam', COALESCE(NEW.first_name, ''), COALESCE(NEW.last_name, '')),
      format(E'**%s %s** just hit LICENSED in APEX — time to provision their agent account.\n\nEmail: %s\nState: %s\n\nClick the link to open their card and hit "Provision" to activate the agent record, unlock production, and send the Welcome email.',
             COALESCE(NEW.first_name, ''), COALESCE(NEW.last_name, ''),
             NEW.email, COALESCE(NEW.licensed_states::text, 'TX')),
      format('%s %s just got LICENSED. Provision them now.', COALESCE(NEW.first_name, ''), COALESCE(NEW.last_name, '')),
      format('https://apex-financial.org/dashboard/hiring-pipeline?application=%s', NEW.id),
      ARRAY['email','sms','discord']::text[]
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the UPDATE on a notification failure
  RETURN NEW;
END $$;
