-- Mirror of MCP-applied migration brand_leads (version 20260925050947).
-- Sam's personal-brand funnel leads (mentorship x3, fitness coaching, AZ car rentals, join-team).
-- Static pages on Vercel insert via the anon key; RLS allows INSERT only. Each insert raises a
-- bot_alert (celebrate -> ntfy + discord) so Sam is pushed on every lead.
begin;
create table if not exists public.brand_leads (
  id uuid primary key default gen_random_uuid(), source text not null, name text, email text, phone text,
  income_range text, fit_reason text, answers jsonb not null default '{}'::jsonb, rental_start date, rental_end date,
  page text, user_agent text, status text not null default 'new', created_at timestamptz not null default now());
create index if not exists brand_leads_created_idx on public.brand_leads (created_at desc);
create index if not exists brand_leads_source_idx on public.brand_leads (source);
alter table public.brand_leads enable row level security;
drop policy if exists brand_leads_public_insert on public.brand_leads;
create policy brand_leads_public_insert on public.brand_leads for insert to anon, authenticated
  with check (source is not null and (email is not null or phone is not null));
drop policy if exists brand_leads_admin_read on public.brand_leads;
create policy brand_leads_admin_read on public.brand_leads for select using (has_role(auth.uid(), 'admin'::app_role));
drop policy if exists brand_leads_admin_update on public.brand_leads;
create policy brand_leads_admin_update on public.brand_leads for update using (has_role(auth.uid(), 'admin'::app_role));
grant insert on public.brand_leads to anon, authenticated;
grant select, update on public.brand_leads to authenticated;
create or replace function public.fn_brand_lead_alert() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_label text; v_subject text; v_body text; v_sms text;
begin
  v_label := case new.source
    when 'mentorship_car_rentals' then 'Mentorship: Car Rentals' when 'mentorship_run_team' then 'Mentorship: Run a Team'
    when 'mentorship_fitness' then 'Mentorship: Fitness' when 'fitness_plan_300' then 'Fitness: $300 Full Plan'
    when 'fitness_high_ticket' then 'Fitness: 1-on-1 (high ticket)' when 'rental_inquiry' then 'Car Rental inquiry (AZ)'
    when 'join_team' then 'Join my team' else new.source end;
  v_subject := 'New lead - ' || v_label || ' - ' || coalesce(new.name, 'no name');
  v_body := '<p><b>' || v_label || '</b></p><p>Name: ' || coalesce(new.name,'-') || '<br/>Phone: ' || coalesce(new.phone,'-') ||
            '<br/>Email: ' || coalesce(new.email,'-') || '<br/>Income: ' || coalesce(new.income_range,'-') ||
            case when new.rental_start is not null then '<br/>Rental: ' || new.rental_start::text || ' to ' || coalesce(new.rental_end::text,'?') else '' end ||
            '</p><p>Why a fit: ' || coalesce(new.fit_reason,'-') || '</p>' ||
            case when new.answers <> '{}'::jsonb then '<p>Answers: ' || new.answers::text || '</p>' else '' end;
  v_sms := 'New lead ' || v_label || ': ' || coalesce(new.name,'?') || ' ' || coalesce(new.phone, coalesce(new.email,''));
  begin
    insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
    values ('brand_funnel', 'brand_lead', 'celebrate', v_subject, v_body, v_sms, array['ntfy','discord']::text[]);
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_brand_lead_alert on public.brand_leads;
create trigger trg_brand_lead_alert after insert on public.brand_leads for each row execute function public.fn_brand_lead_alert();
create or replace view public.v_brand_leads with (security_invoker = true) as
select id, created_at at time zone 'America/Phoenix' as created_phx, source, name, phone, email, income_range,
       left(coalesce(fit_reason,''), 120) as fit_reason, rental_start, rental_end, status, page
from public.brand_leads order by created_at desc;
grant select on public.v_brand_leads to authenticated;
commit;
