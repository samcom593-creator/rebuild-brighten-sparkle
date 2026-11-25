-- Normalize status labels through a fixed enum instead of printing arbitrary source text.
with normalized as (
  select regexp_replace(lower(btrim(coalesce(policy_status,''))), '[^a-z0-9]+','_','g') as raw_status,
    agent_id is null as unassigned, matched_deal_id is not null as linked_deal
  from public.carrier_policies
), classified as (
  select case when raw_status in (
    'premium_paying','renewal_premium_processing','pending_initial_premium','pending_death_claim',
    'grace_period','late_offer_period','lapse_pending','lapsepending','lapsed','cancelled','canceled',
    'terminated','free_look_surrendered','not_taken_initial_premium_failed','unissued_initial_premium_failed',
    'invalid_application','declined','disqualified_instant_no_reroute','policy_unissued','withdrawn',
    'not_taken','nottaken','abandoned','closed_administrative','closed_external_trustage','in_force',
    'inforce','active','paid','issued_and_paid','issued_paid','issued','issued_not_paid','approved',
    'approved_instant','approved_not_issued','pending','in_review','underwriting','submitted',
    'submitted_for_future_issuance','completed','rerouted_trustage','policy_activated_external_trustage',
    'started','quote') then raw_status else 'unknown' end as status,
    unassigned, linked_deal from normalized
), groups as (
  select status, count(*) as rows, count(*) filter(where unassigned) as unassigned_rows,
    count(*) filter(where linked_deal) as linked_deal_rows from classified group by status
)
select coalesce(jsonb_agg(to_jsonb(g) order by status),'[]'::jsonb) as carrier_status from groups g
