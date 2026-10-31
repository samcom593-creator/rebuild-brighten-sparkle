-- OVERHAUL-states (2026-10-30): the Book of Business says where to buy leads.
--
-- Sam (2026-10-30): "On Book of Business, show what states I should get, in order: where most of our deals
-- are coming from, so I know where most of my leads are from. I need to rebuy [leads from my vendor] in
-- these states, so I need to know exactly what to get."
--
-- MEASURED FIRST (as the database, 2026-10-30): the book (v_book_of_business, 1,632 policies) carries no
-- client state at all, and the client records it could borrow one from are nearly empty: AgentLink's client
-- records hold a state for 90 of 2,028 clients (16 of them on the book), the sold-call packets for 14 book
-- clients. The client's phone is the fact the book does carry: 1,426 of the 1,499 policies with a client have
-- one (native deals by id, AgentLink rows through their client record or the posted deal with the same policy
-- number and client). So a policy's state is layered and labelled, the way Book Flips already does it:
--   on_file    the client's state on record: the AgentLink client record, else the state the client gave on a
--              sold call (readymode_booking_packets), else the state on the lead list the number was bought on
--              (client_leads, 125,257 leads with an address state); 316 policies;
--   area_code  otherwise the phone's area code (us_area_codes below), a likely state, not a fact, because
--              people keep a number when they move; 1,079 policies. Across the lead lists the area code names
--              the state on the list for 107,299 of 125,008 leads (86%);
--   null       no client (production reported as a total: 133 rows) or no phone with a US area code (104);
--              its own row on the page, never dropped.
--
-- us_area_codes: every US geographic area code (NANPA assignments, the 50 states and DC; 349 codes),
-- checked against the lead lists before it was written: for every area code with 20 or more leads, the state
-- most of its leads live in is the state in this table (0 disagreements). Toll-free, Canadian and territory
-- codes are deliberately absent, so they read as unknown instead of a guess.
--
-- v_book_of_business gains two columns at the end, client_state and client_state_source, computed under the
-- view's own rights from the same rows (so a manager or an agent sees the state of exactly the policies they
-- could already see) and nothing else changes: same rows, same scope, same columns before them (proven: the
-- old columns of the new view EXCEPT ALL the live view is empty both ways, 1,632 rows). The phone is used
-- inside the view and never exposed. Measured as Sam: the list read went from ~615 to ~685 ms, a count that
-- does not ask for the state from ~580 to ~620 ms (the lead-list and packet lookups drop out of it).
--
-- book_state_summary(p_agent_ids) counts the book by client state inside the caller's scope (SECURITY INVOKER,
-- the same p_agent_ids rule as book_of_business_counts), so a state's numbers are the list that state opens,
-- the states add up to the book, and the policies with no state are their own row. It also says, per state,
-- how many active agents have that state on their license list and how many active agents sold a policy there
-- (state on file) in the last 180 days: the evidence that someone can still write the leads Sam buys.
--
-- lead_state_yield() answers the lead-list side for the full-book readers only (Sam's admin logins and the
-- book_readers list): per state, leads bought (the lead lists, Galaxy's own Ethos customer list left out),
-- how many have no dialer call on record, the numbers the dialer called (by the list's state, else the area
-- code), and the book policies sold to a dialed number on or after its first call. SECURITY DEFINER because
-- the lead lists are admin-only and Aisha is a full-book reader without admin; it raises 42501 for anyone
-- else. There is no lead cost anywhere in the database (lead_purchases are agents paying for the dialer), so
-- cost per sale is computed on the page from a price Sam types, never stored or guessed.
--
-- readymode_dialer_calls gets an index on (lead_phone10, call_started_at) so the first-call lookup reads the
-- index instead of all ~140,000 calls.
--
-- Nothing is deleted. Proven before shipping in rolled-back transactions as Sam, Aisha, a manager, an agent,
-- a VA and anon (see the PR).

-- ---------------------------------------------------------------------------------------------------------
-- 1. US area codes
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.us_area_codes (
  area_code text primary key check (area_code ~ '^[2-9][0-9]{2}$'),
  state text not null check (state ~ '^[A-Z]{2}$')
);

comment on table public.us_area_codes is
  'OVERHAUL-states (2026-10-30): every US geographic area code and its state (NANPA assignments, 50 states and DC). Read by v_book_of_business and lead_state_yield() to give a policy a likely state from the client''s phone when no state is on record. Toll-free, Canadian and territory codes are absent on purpose.';

alter table public.us_area_codes enable row level security;
revoke all on table public.us_area_codes from public, anon, authenticated;
grant select on table public.us_area_codes to service_role;

insert into public.us_area_codes (area_code, state) values
  ('205', 'AL'), ('251', 'AL'), ('256', 'AL'), ('334', 'AL'), ('659', 'AL'), ('938', 'AL'),
  ('907', 'AK'),
  ('480', 'AZ'), ('520', 'AZ'), ('602', 'AZ'), ('623', 'AZ'), ('928', 'AZ'),
  ('327', 'AR'), ('479', 'AR'), ('501', 'AR'), ('870', 'AR'),
  ('209', 'CA'), ('213', 'CA'), ('279', 'CA'), ('310', 'CA'), ('323', 'CA'), ('341', 'CA'), ('350', 'CA'), ('408', 'CA'),
  ('415', 'CA'), ('424', 'CA'), ('442', 'CA'), ('510', 'CA'), ('530', 'CA'), ('559', 'CA'), ('562', 'CA'), ('619', 'CA'),
  ('626', 'CA'), ('628', 'CA'), ('650', 'CA'), ('657', 'CA'), ('661', 'CA'), ('669', 'CA'), ('707', 'CA'), ('714', 'CA'),
  ('747', 'CA'), ('760', 'CA'), ('805', 'CA'), ('818', 'CA'), ('820', 'CA'), ('831', 'CA'), ('840', 'CA'), ('858', 'CA'),
  ('909', 'CA'), ('916', 'CA'), ('925', 'CA'), ('949', 'CA'), ('951', 'CA'),
  ('303', 'CO'), ('719', 'CO'), ('720', 'CO'), ('970', 'CO'),
  ('203', 'CT'), ('475', 'CT'), ('860', 'CT'), ('959', 'CT'),
  ('302', 'DE'),
  ('202', 'DC'), ('771', 'DC'),
  ('239', 'FL'), ('305', 'FL'), ('321', 'FL'), ('352', 'FL'), ('386', 'FL'), ('407', 'FL'), ('448', 'FL'), ('561', 'FL'),
  ('645', 'FL'), ('656', 'FL'), ('689', 'FL'), ('727', 'FL'), ('754', 'FL'), ('772', 'FL'), ('786', 'FL'), ('813', 'FL'),
  ('850', 'FL'), ('863', 'FL'), ('904', 'FL'), ('941', 'FL'), ('954', 'FL'),
  ('229', 'GA'), ('404', 'GA'), ('470', 'GA'), ('478', 'GA'), ('678', 'GA'), ('706', 'GA'), ('762', 'GA'), ('770', 'GA'),
  ('912', 'GA'),
  ('808', 'HI'),
  ('208', 'ID'), ('986', 'ID'),
  ('217', 'IL'), ('224', 'IL'), ('309', 'IL'), ('312', 'IL'), ('331', 'IL'), ('447', 'IL'), ('464', 'IL'), ('618', 'IL'),
  ('630', 'IL'), ('708', 'IL'), ('730', 'IL'), ('773', 'IL'), ('779', 'IL'), ('815', 'IL'), ('847', 'IL'), ('872', 'IL'),
  ('219', 'IN'), ('260', 'IN'), ('317', 'IN'), ('463', 'IN'), ('574', 'IN'), ('765', 'IN'), ('812', 'IN'), ('930', 'IN'),
  ('319', 'IA'), ('515', 'IA'), ('563', 'IA'), ('641', 'IA'), ('712', 'IA'),
  ('316', 'KS'), ('620', 'KS'), ('785', 'KS'), ('913', 'KS'),
  ('270', 'KY'), ('364', 'KY'), ('502', 'KY'), ('606', 'KY'), ('859', 'KY'),
  ('225', 'LA'), ('318', 'LA'), ('337', 'LA'), ('504', 'LA'), ('985', 'LA'),
  ('207', 'ME'),
  ('227', 'MD'), ('240', 'MD'), ('301', 'MD'), ('410', 'MD'), ('443', 'MD'), ('667', 'MD'),
  ('339', 'MA'), ('351', 'MA'), ('413', 'MA'), ('508', 'MA'), ('617', 'MA'), ('774', 'MA'), ('781', 'MA'), ('857', 'MA'),
  ('978', 'MA'),
  ('231', 'MI'), ('248', 'MI'), ('269', 'MI'), ('313', 'MI'), ('517', 'MI'), ('586', 'MI'), ('616', 'MI'), ('679', 'MI'),
  ('734', 'MI'), ('810', 'MI'), ('906', 'MI'), ('947', 'MI'), ('989', 'MI'),
  ('218', 'MN'), ('320', 'MN'), ('507', 'MN'), ('612', 'MN'), ('651', 'MN'), ('763', 'MN'), ('952', 'MN'),
  ('228', 'MS'), ('601', 'MS'), ('662', 'MS'), ('769', 'MS'),
  ('314', 'MO'), ('417', 'MO'), ('557', 'MO'), ('573', 'MO'), ('636', 'MO'), ('660', 'MO'), ('816', 'MO'),
  ('406', 'MT'),
  ('308', 'NE'), ('402', 'NE'), ('531', 'NE'),
  ('702', 'NV'), ('725', 'NV'), ('775', 'NV'),
  ('603', 'NH'),
  ('201', 'NJ'), ('551', 'NJ'), ('609', 'NJ'), ('640', 'NJ'), ('732', 'NJ'), ('848', 'NJ'), ('856', 'NJ'), ('862', 'NJ'),
  ('908', 'NJ'), ('973', 'NJ'),
  ('505', 'NM'), ('575', 'NM'),
  ('212', 'NY'), ('315', 'NY'), ('332', 'NY'), ('347', 'NY'), ('363', 'NY'), ('516', 'NY'), ('518', 'NY'), ('585', 'NY'),
  ('607', 'NY'), ('624', 'NY'), ('631', 'NY'), ('646', 'NY'), ('680', 'NY'), ('716', 'NY'), ('718', 'NY'), ('838', 'NY'),
  ('845', 'NY'), ('914', 'NY'), ('917', 'NY'), ('929', 'NY'), ('934', 'NY'),
  ('252', 'NC'), ('336', 'NC'), ('472', 'NC'), ('704', 'NC'), ('743', 'NC'), ('828', 'NC'), ('910', 'NC'), ('919', 'NC'),
  ('980', 'NC'), ('984', 'NC'),
  ('701', 'ND'),
  ('216', 'OH'), ('220', 'OH'), ('234', 'OH'), ('283', 'OH'), ('326', 'OH'), ('330', 'OH'), ('380', 'OH'), ('419', 'OH'),
  ('440', 'OH'), ('513', 'OH'), ('567', 'OH'), ('614', 'OH'), ('740', 'OH'), ('937', 'OH'),
  ('405', 'OK'), ('539', 'OK'), ('572', 'OK'), ('580', 'OK'), ('918', 'OK'),
  ('458', 'OR'), ('503', 'OR'), ('541', 'OR'), ('971', 'OR'),
  ('215', 'PA'), ('223', 'PA'), ('267', 'PA'), ('272', 'PA'), ('412', 'PA'), ('445', 'PA'), ('484', 'PA'), ('570', 'PA'),
  ('582', 'PA'), ('610', 'PA'), ('717', 'PA'), ('724', 'PA'), ('814', 'PA'), ('835', 'PA'), ('878', 'PA'),
  ('401', 'RI'),
  ('803', 'SC'), ('821', 'SC'), ('839', 'SC'), ('843', 'SC'), ('854', 'SC'), ('864', 'SC'),
  ('605', 'SD'),
  ('423', 'TN'), ('615', 'TN'), ('629', 'TN'), ('731', 'TN'), ('865', 'TN'), ('901', 'TN'), ('931', 'TN'),
  ('210', 'TX'), ('214', 'TX'), ('254', 'TX'), ('281', 'TX'), ('325', 'TX'), ('346', 'TX'), ('361', 'TX'), ('409', 'TX'),
  ('430', 'TX'), ('432', 'TX'), ('469', 'TX'), ('512', 'TX'), ('682', 'TX'), ('713', 'TX'), ('726', 'TX'), ('737', 'TX'),
  ('806', 'TX'), ('817', 'TX'), ('830', 'TX'), ('832', 'TX'), ('903', 'TX'), ('915', 'TX'), ('936', 'TX'), ('940', 'TX'),
  ('945', 'TX'), ('956', 'TX'), ('972', 'TX'), ('979', 'TX'),
  ('385', 'UT'), ('435', 'UT'), ('801', 'UT'),
  ('802', 'VT'),
  ('276', 'VA'), ('434', 'VA'), ('540', 'VA'), ('571', 'VA'), ('686', 'VA'), ('703', 'VA'), ('757', 'VA'), ('804', 'VA'),
  ('826', 'VA'), ('948', 'VA'),
  ('206', 'WA'), ('253', 'WA'), ('360', 'WA'), ('425', 'WA'), ('509', 'WA'), ('564', 'WA'),
  ('304', 'WV'), ('681', 'WV'),
  ('262', 'WI'), ('414', 'WI'), ('534', 'WI'), ('608', 'WI'), ('715', 'WI'), ('920', 'WI'),
  ('307', 'WY')
on conflict (area_code) do update set state = excluded.state;

-- ---------------------------------------------------------------------------------------------------------
-- 2. A state written any way (TX, tx, Texas, " new york ") as its two-letter code; anything else is null
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.us_state_code(p_value text)
returns text
language sql
immutable
parallel safe
as $function$
  select case
    when pg_catalog.upper(pg_catalog.btrim(p_value)) in (
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
      'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
      'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY')
      then pg_catalog.upper(pg_catalog.btrim(p_value))
    else case pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(p_value, '[[:space:].]+', ' ', 'g')))
      when 'alabama' then 'AL' when 'alaska' then 'AK' when 'arizona' then 'AZ' when 'arkansas' then 'AR'
      when 'california' then 'CA' when 'colorado' then 'CO' when 'connecticut' then 'CT' when 'delaware' then 'DE'
      when 'district of columbia' then 'DC' when 'washington d c' then 'DC' when 'washington dc' then 'DC'
      when 'florida' then 'FL' when 'georgia' then 'GA' when 'hawaii' then 'HI' when 'idaho' then 'ID'
      when 'illinois' then 'IL' when 'indiana' then 'IN' when 'iowa' then 'IA' when 'kansas' then 'KS'
      when 'kentucky' then 'KY' when 'louisiana' then 'LA' when 'maine' then 'ME' when 'maryland' then 'MD'
      when 'massachusetts' then 'MA' when 'michigan' then 'MI' when 'minnesota' then 'MN' when 'mississippi' then 'MS'
      when 'missouri' then 'MO' when 'montana' then 'MT' when 'nebraska' then 'NE' when 'nevada' then 'NV'
      when 'new hampshire' then 'NH' when 'new jersey' then 'NJ' when 'new mexico' then 'NM' when 'new york' then 'NY'
      when 'north carolina' then 'NC' when 'north dakota' then 'ND' when 'ohio' then 'OH' when 'oklahoma' then 'OK'
      when 'oregon' then 'OR' when 'pennsylvania' then 'PA' when 'rhode island' then 'RI' when 'south carolina' then 'SC'
      when 'south dakota' then 'SD' when 'tennessee' then 'TN' when 'texas' then 'TX' when 'utah' then 'UT'
      when 'vermont' then 'VT' when 'virginia' then 'VA' when 'washington' then 'WA' when 'west virginia' then 'WV'
      when 'wisconsin' then 'WI' when 'wyoming' then 'WY'
    end
  end
$function$;

comment on function public.us_state_code(text) is
  'OVERHAUL-states (2026-10-30): a US state (or DC) written as a code or a name, in any case and spacing, as its two-letter code; anything else (blank, NA, a typo, a territory) is null, so it reads as unknown, never as a wrong state.';

revoke all on function public.us_state_code(text) from public, anon;
grant execute on function public.us_state_code(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 3. v_book_of_business: the same view, plus the client's state and how it is known
-- ---------------------------------------------------------------------------------------------------------
create or replace view public.v_book_of_business
with (security_barrier = true) as
select q.row_key, q.origin, q.agent_id, q.agent_name, q.client_name, q.carrier, q.product,
       q.policy_number, q.annual_premium, q.posted_date, q.effective_date, q.status, q.synced_at,
       q.status_key, q.standing, q.client_state, q.client_state_source
from (
  with on_books as (
    -- Every row of the production book. A native deal carries the policy status its agent recorded.
    select u.row_key, u.origin, u.agent_id, u.agent_name, u.client_name, u.carrier, u.product,
           u.policy_number, u.annual_premium, u.posted_date, u.effective_date,
           case when u.origin = 'apex_native' then coalesce(nullif(btrim(nd.policy_status_standard), ''), u.status)
                else u.status end as status,
           u.synced_at,
           false as is_dead
      from public.v_production_unified u
      left join public.deals nd
        on nd.id = case when u.origin = 'apex_native' then u.row_key::uuid end
  ),
  off_books_agentlink as (
    -- The AgentLink policies v_production_canonical drops as dead, under the same agent-name rule.
    select b.deal_key as row_key, 'agentlink'::text as origin, b.agent_id, b.agent_name, b.client_name,
           b.carrier, b.product, b.policy_number, b.annual_premium, b.posted_date, b.effective_date,
           b.status, b.imported_at as synced_at, true as is_dead
      from public.v_agentlink_book_scoped b
     where b.is_dead is true
       and case when b.agent_id is null then public.fn_book_agent_name_known(b.agent_name) else true end
  ),
  off_books_native as (
    -- The native deals v_production_canonical drops for a dead workflow status (none on 2026-10-29),
    -- under the same rules it applies to the native deals it keeps.
    select d.id::text as row_key, 'apex_native'::text as origin, d.agent_id,
           coalesce(ag.display_name, 'Agent'::text) as agent_name,
           btrim(coalesce(d.client_first_name, '') || ' ' || coalesce(d.client_last_name, '')) as client_name,
           c.name as carrier, d.product_sold as product, d.policy_number, d.annual_premium,
           (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date as posted_date,
           d.effective_date,
           coalesce(nullif(btrim(d.policy_status_standard), ''), d.status) as status,
           d.created_at as synced_at, true as is_dead
      from public.deals d
      left join public.agents ag on ag.id = d.agent_id
      left join public.carriers c on c.id = d.carrier_id
     where d.agent_id is not null
       and d.annual_premium is not null
       and d.source::text = 'apex_native'
       and lower(coalesce(d.status, '')) = any (array['lapsed', 'cancelled', 'charged_back', 'withdrawn', 'not_taken', 'declined'])
       and not public.fn_agent_is_roster_excluded(d.agent_id)
       and not exists (
         select 1 from public.v_agentlink_book_scoped b
          where nullif(btrim(coalesce(b.policy_number, '')), '') is not null
            and lower(btrim(b.policy_number)) = lower(btrim(coalesce(d.policy_number, ''))))
       and not exists (
         select 1 from public.v_agentlink_book_scoped b2
          where b2.agent_id = d.agent_id and b2.annual_premium = d.annual_premium and b2.effective_date = d.effective_date
            and lower(btrim(coalesce(b2.client_name, ''))) = lower(btrim(coalesce(d.client_first_name, '') || ' ' || coalesce(d.client_last_name, ''))))
  ),
  book as (
    select * from on_books
    union all
    select * from off_books_agentlink
    union all
    select * from off_books_native
  ),
  located as (
    -- The client's phone (10 digits) and the state on their AgentLink client record, for the rows with a client.
    select book.*,
           -- book-row-phone: begin
           coalesce(
             nullif(right(regexp_replace(coalesce(nd2.client_phone, ''), '\D', '', 'g'), 10), ''),
             nullif(right(regexp_replace(coalesce(rec.phone, ''), '\D', '', 'g'), 10), ''),
             dp.phone10
           ) as phone10,
           -- book-row-phone: end
           public.us_state_code(rec.state) as record_state
      from book
      -- book-row-joins: begin
      left join public.deals nd2
        on nd2.id = case when book.origin = 'apex_native' then book.row_key::uuid end
      left join public.agentlink_book rab
        on rab.deal_key = case when book.origin = 'agentlink' then book.row_key end
      left join public.agentlink_clients rec
        on rec.insuracloud_pipeline_client_id = rab.pipeline_client_id
      left join (
        -- The posted deal with the same policy number and client, for an AgentLink row: 72 policy numbers are
        -- shared by more than one client, so the client must match too.
        select distinct on (btrim(d.policy_number), public.book_flip_client_key(concat_ws(' ', d.client_first_name, d.client_last_name), null::integer, null::text))
               btrim(d.policy_number) as policy_number,
               public.book_flip_client_key(concat_ws(' ', d.client_first_name, d.client_last_name), null::integer, null::text) as client_key,
               nullif(right(regexp_replace(d.client_phone, '\D', '', 'g'), 10), '') as phone10
          from public.deals d
         where nullif(btrim(d.policy_number), '') is not null
           and nullif(btrim(d.client_phone), '') is not null
         order by btrim(d.policy_number),
                  public.book_flip_client_key(concat_ws(' ', d.client_first_name, d.client_last_name), null::integer, null::text),
                  d.updated_at desc nulls last, d.id
      ) dp
        on book.origin = 'agentlink'
       and dp.policy_number = btrim(book.policy_number)
       and dp.client_key = public.book_flip_client_key(book.client_name, null::integer, null::text)
      -- book-row-joins: end
  ),
  placed as (
    -- Where the client is: on record (client record, sold-call packet, lead list), else the area code.
    select located.*,
           pk.state as packet_state,
           -- The lead list holds one lead per number (phone_digits is unique). Looked up per row by that index,
           -- and only when the state is asked for: a read that does not ask never runs it.
           (select public.us_state_code(l.state) from public.client_leads l where l.phone_digits = located.phone10) as list_state,
           ac.state as area_state
      from located
      left join (
        select distinct on (k.phone10) k.phone10, k.state
          from (select nullif(right(regexp_replace(coalesce(p.client_phone, ''), '\D', '', 'g'), 10), '') as phone10,
                       public.us_state_code(p.client_state) as state, p.call_at, p.id
                  from public.readymode_booking_packets p) k
         where k.phone10 is not null and k.state is not null
         order by k.phone10, k.call_at desc nulls last, k.id
      ) pk on pk.phone10 = located.phone10
      left join public.us_area_codes ac
        on ac.area_code = case when located.phone10 ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then left(located.phone10, 3) end
  )
  select placed.row_key, placed.origin, placed.agent_id, placed.agent_name, placed.client_name, placed.carrier,
         placed.product, placed.policy_number, placed.annual_premium, placed.posted_date, placed.effective_date,
         placed.status, placed.synced_at, placed.is_dead,
         k.status_key,
         case
           when k.status_key = any (array['active', 'approved', 'issued', 'in_force', 'paid']) then 'active'
           when k.status_key = any (array['lapse_pending', 'lapsed', 'grace_period']) then 'lapsing'
           when k.status_key = any (array['declined', 'withdrawn', 'not_taken', 'cancelled', 'terminated', 'postponed',
                                          'rescinded', 'surrendered', 'deceased', 'closed', 'incomplete', 'charged_back',
                                          'not_in_force'])
                or placed.is_dead then 'gone'
           when k.status_key = any (array['pending', 'in_review', 'submitted', 'underwriting', 'issued_not_paid',
                                          'approved_not_issued', 'needs_review']) then 'pending'
           else 'unknown'
         end as standing,
         coalesce(placed.record_state, placed.packet_state, placed.list_state, placed.area_state) as client_state,
         case
           when coalesce(placed.record_state, placed.packet_state, placed.list_state) is not null then 'on_file'
           when placed.area_state is not null then 'area_code'
         end as client_state_source
    from placed
   cross join lateral (
     select case r.raw_key
              when 'canceled' then 'cancelled'
              when 'chargeback' then 'charged_back'
              when 'inforce' then 'in_force'
              when 'dead' then 'not_in_force'
              when '' then 'unknown'
              else r.raw_key
            end as status_key
       from (select lower(regexp_replace(btrim(coalesce(placed.status, '')), '[[:space:],_-]+', '_', 'g')) as raw_key) r
   ) k
) q
where current_user <> all (array['anon'::name, 'authenticated'::name])
   or (select public.api_is_full_reader())
   or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[]);

comment on view public.v_book_of_business is
  'OVERHAUL-book (2026-10-29): every policy on the book, including the ones that left it, with its standing (active, pending, lapsing, gone, unknown) and a normalised status_key. Same rows and scope as v_production_unified plus dead AgentLink policies and dead native deals. OVERHAUL-states (2026-10-30): client_state is the client''s state (two letters) and client_state_source says how it is known: on_file (client record, sold-call packet or lead list) or area_code (the phone''s area code, likely, not certain); both null when neither is known. Read by /dashboard/production.';

revoke all on table public.v_book_of_business from public, anon, authenticated;
grant select on table public.v_book_of_business to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 4. The book by client state, inside the caller's scope
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.book_state_summary(p_agent_ids uuid[] default null)
returns table(
  state text,
  policies integer,
  on_file integer,
  clients integer,
  annual_premium numeric,
  premium_policies integer,
  active integer,
  pending integer,
  lapsing integer,
  gone integer,
  no_status integer,
  last_30_days integer,
  last_90_days integer,
  prior_90_days integer,
  licensed_agents integer,
  active_writers integer,
  no_client integer
)
language sql
stable
security invoker
set search_path = public
as $function$
  with t as (
    select (now() at time zone 'America/Phoenix')::date as today
  ),
  active_agents as (
    select a.id, a.license_states
      from public.agents a
     where a.status::text = 'active'
       and not coalesce(a.is_inactive, false)
       and not coalesce(a.is_deactivated, false)
  ),
  licensed as (
    select s.code as state, count(distinct aa.id)::integer as agents
      from active_agents aa
     cross join lateral (
       select public.us_state_code(x) as code from unnest(coalesce(aa.license_states, '{}'::text[])) as x
     ) s
     where s.code is not null
     group by s.code
  ),
  b as (
    select v.client_state, v.client_state_source, v.client_name, v.annual_premium, v.standing, v.posted_date, v.agent_id
      from public.v_book_of_business v
     where p_agent_ids is null or v.agent_id = any (p_agent_ids)
  )
  select b.client_state as state,
         count(*)::integer as policies,
         count(*) filter (where b.client_state_source = 'on_file')::integer as on_file,
         count(distinct nullif(public.book_flip_client_key(nullif(btrim(b.client_name), ''), null::integer, null::text), ''))::integer as clients,
         coalesce(sum(b.annual_premium), 0)::numeric as annual_premium,
         count(b.annual_premium)::integer as premium_policies,
         count(*) filter (where b.standing = 'active')::integer as active,
         count(*) filter (where b.standing = 'pending')::integer as pending,
         count(*) filter (where b.standing = 'lapsing')::integer as lapsing,
         count(*) filter (where b.standing = 'gone')::integer as gone,
         count(*) filter (where b.standing is null or b.standing not in ('active', 'pending', 'lapsing', 'gone'))::integer as no_status,
         count(*) filter (where b.posted_date > t.today - 30)::integer as last_30_days,
         count(*) filter (where b.posted_date > t.today - 90)::integer as last_90_days,
         count(*) filter (where b.posted_date <= t.today - 90 and b.posted_date > t.today - 180)::integer as prior_90_days,
         coalesce(max(l.agents), 0)::integer as licensed_agents,
         count(distinct b.agent_id) filter (where w.id is not null and b.client_state_source = 'on_file'
                                                  and b.posted_date > t.today - 180)::integer as active_writers,
         -- Production reported as a total (no client named): it can never have a state.
         count(*) filter (where nullif(btrim(coalesce(b.client_name, '')), '') is null)::integer as no_client
    from b
   cross join t
    left join licensed l on l.state = b.client_state
    left join active_agents w on w.id = b.agent_id
   group by b.client_state
   order by count(*) desc, b.client_state nulls last
$function$;

comment on function public.book_state_summary(uuid[]) is
  'OVERHAUL-states (2026-10-30): v_book_of_business counted by client_state (null = not known, its own row) inside the caller''s scope; p_agent_ids narrows to the agents the page lists, as in book_of_business_counts, so the states add up to the book and each state''s numbers are the list it opens. Windows are Phoenix days: last 30, last 90 and the 90 before them. licensed_agents = active agents with the state on their license list; active_writers = active agents who sold a policy there (state on file) in the last 180 days; no_client = rows reported as a total with no client named.';

revoke all on function public.book_state_summary(uuid[]) from public, anon;
grant execute on function public.book_state_summary(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 5. The lead lists by state (full-book readers only)
-- ---------------------------------------------------------------------------------------------------------
create index if not exists idx_rmd_lead_phone10_started
  on public.readymode_dialer_calls (lead_phone10, call_started_at)
  where lead_phone10 is not null;

create or replace function public.lead_state_yield()
returns table(
  state text,
  leads_bought integer,
  never_called integer,
  leads_dialed integer,
  dialed_sales integer,
  area_checked integer,
  area_matched integer,
  calls_since date,
  lists_loaded date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not coalesce(public.api_is_full_reader(), false) then
    raise exception 'Only the full-book readers can read the lead lists.' using errcode = '42501';
  end if;

  return query
  with
  -- Every number the dialer has called, with the day of its first call.
  dial as materialized (
    select c.lead_phone10 as phone10, min(c.call_started_at) as first_call
      from public.readymode_dialer_calls c
     where c.lead_phone10 is not null
       and c.lead_phone10 ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
     group by c.lead_phone10
  ),
  -- The lead lists: every bought lead and the state on its list. Galaxy's own Ethos customer list lives in
  -- the same table and nobody bought it, so it is left out.
  lists as materialized (
    select l.phone_digits as phone10, public.us_state_code(l.state) as list_state, l.created_at
      from public.client_leads l
     where l.source_file is distinct from 'ethos_customers'
  ),
  -- A dialed number's state: the state on its list when it is on one, else its area code's.
  dialed as (
    select d.phone10, d.first_call, coalesce(ls.list_state, ac.state) as state
      from dial d
      left join lists ls on ls.phone10 = d.phone10
      left join public.us_area_codes ac on ac.area_code = left(d.phone10, 3)
  ),
  -- Each book policy's client phone, read exactly the way v_book_of_business reads it (a test pins the two).
  book_phone as (
    select book.row_key, book.posted_date,
           -- book-row-phone: begin
           coalesce(
             nullif(right(regexp_replace(coalesce(nd2.client_phone, ''), '\D', '', 'g'), 10), ''),
             nullif(right(regexp_replace(coalesce(rec.phone, ''), '\D', '', 'g'), 10), ''),
             dp.phone10
           ) as phone10,
           -- book-row-phone: end
           book.origin
      from public.v_book_of_business book
      -- book-row-joins: begin
      left join public.deals nd2
        on nd2.id = case when book.origin = 'apex_native' then book.row_key::uuid end
      left join public.agentlink_book rab
        on rab.deal_key = case when book.origin = 'agentlink' then book.row_key end
      left join public.agentlink_clients rec
        on rec.insuracloud_pipeline_client_id = rab.pipeline_client_id
      left join (
        -- The posted deal with the same policy number and client, for an AgentLink row: 72 policy numbers are
        -- shared by more than one client, so the client must match too.
        select distinct on (btrim(d.policy_number), public.book_flip_client_key(concat_ws(' ', d.client_first_name, d.client_last_name), null::integer, null::text))
               btrim(d.policy_number) as policy_number,
               public.book_flip_client_key(concat_ws(' ', d.client_first_name, d.client_last_name), null::integer, null::text) as client_key,
               nullif(right(regexp_replace(d.client_phone, '\D', '', 'g'), 10), '') as phone10
          from public.deals d
         where nullif(btrim(d.policy_number), '') is not null
           and nullif(btrim(d.client_phone), '') is not null
         order by btrim(d.policy_number),
                  public.book_flip_client_key(concat_ws(' ', d.client_first_name, d.client_last_name), null::integer, null::text),
                  d.updated_at desc nulls last, d.id
      ) dp
        on book.origin = 'agentlink'
       and dp.policy_number = btrim(book.policy_number)
       and dp.client_key = public.book_flip_client_key(book.client_name, null::integer, null::text)
      -- book-row-joins: end
  ),
  -- A sale from a dialed lead: a book policy whose client's number the dialer called on or before the day the
  -- policy was posted (Phoenix days). A policy posted before the first call came from somewhere else.
  sales as (
    select dd.state, count(distinct bp.row_key)::integer as n
      from book_phone bp
      join dialed dd on dd.phone10 = bp.phone10
     where bp.posted_date >= (dd.first_call at time zone 'America/Phoenix')::date
     group by dd.state
  ),
  dialed_by_state as (
    select dd.state, count(*)::integer as n from dialed dd group by dd.state
  ),
  lists_by_state as (
    select ls.list_state as state,
           count(*)::integer as bought,
           count(*) filter (where d.phone10 is null)::integer as never_called,
           count(ac.state)::integer as area_checked,
           count(*) filter (where ac.state = ls.list_state)::integer as area_matched
      from lists ls
      left join dial d on d.phone10 = ls.phone10
      left join public.us_area_codes ac
        on ac.area_code = case when ls.phone10 ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then left(ls.phone10, 3) end
     group by ls.list_state
  ),
  states as (
    select lb.state from lists_by_state lb
    union
    select ds.state from dialed_by_state ds
    union
    select s.state from sales s
  ),
  span as (
    select (min(d.first_call) at time zone 'America/Phoenix')::date as calls_since,
           (select (max(ls.created_at) at time zone 'America/Phoenix')::date from lists ls) as lists_loaded
      from dial d
  )
  select st.state,
         coalesce(lb.bought, 0),
         coalesce(lb.never_called, 0),
         coalesce(ds.n, 0),
         coalesce(s.n, 0),
         coalesce(lb.area_checked, 0),
         coalesce(lb.area_matched, 0),
         sp.calls_since,
         sp.lists_loaded
    from states st
   cross join span sp
    left join lists_by_state lb on lb.state is not distinct from st.state
    left join dialed_by_state ds on ds.state is not distinct from st.state
    left join sales s on s.state is not distinct from st.state
   order by st.state nulls last;
end;
$function$;

comment on function public.lead_state_yield() is
  'OVERHAUL-states (2026-10-30): the lead lists by state for the full-book readers (raises 42501 for anyone else): leads bought (client_leads, the Ethos customer list left out), never called (no dialer call on record), leads dialed (numbers the dialer called, by list state else area code), dialed sales (book policies sold to a dialed number on or after its first call), and how often a list lead''s area code names its list state. Lead cost is not in the database.';

revoke all on function public.lead_state_yield() from public, anon;
grant execute on function public.lead_state_yield() to authenticated, service_role;
