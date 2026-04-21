-- ══════════════════════════════════════════════════════════════════════
-- APEX — insert 10 real deals (2026-04-20 batch)
-- Paste into SQL Editor and Run. Resolves agent + carrier by name.
-- Safe to re-run (upserts on policy_number).
-- ══════════════════════════════════════════════════════════════════════

-- Make sure unique index on policy_number exists for the upsert conflict key
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_policy_number_unique
  ON public.deals(policy_number) WHERE policy_number IS NOT NULL;

WITH rows AS (
  SELECT * FROM (VALUES
    -- (client_first, client_last,      carrier_name,       product,                                policy_number,   monthly,  annual,    eff_date,     agent_full_name)
    ('Charles',  'Walker',              'Newbridge',         'Level Death Benefit Ages 0-79',        'ARCF26110g319', 150.49,  1805.88,   '2026-04-20', 'Grey Bowman'),
    ('Brenda',   'Barber',              'American Home Life','Final Expense',                        '000008211854',  91.00,   1092.00,   '2026-05-03', 'Mahmod Imran'),
    ('Gary',     'Thomas',              'Transamerica',      'Final Expense',                        'TA-GARY-THOMAS',69.26,   831.12,    '2026-05-11', 'Cooper Ubert'),
    ('Dianne',   'Carstensen',          'American Home Life','Final Expense',                        '000008274439',  97.75,   1173.00,   '2026-04-20', 'Xaviar Watts'),
    ('Joy',      'Talbert',             'Newbridge',         'Level Death Benefit Ages 80-85',       'ARCF26110g381', 190.20,  2282.40,   '2026-05-04', 'Chukwudi Ifediora'),
    ('Stephanie','Young',               'Transamerica',      'FE Express',                           'POL-STEPHYOUNG',88.97,   1067.64,   '2026-05-03', 'Michael Kayembe'),
    ('Arlitha',  'Mcdowell',            'Royal Neighbors',   'Simplified Issue WL Ages 50-75',       '000008274359',  155.51,  1866.12,   '2026-04-30', 'Aisha Kebbeh'),
    ('Sheryl',   'Thomas',              'American Home Life','Final Expense',                        'POL-12345',     172.73,  2072.76,   '2026-05-15', 'Cooper Ubert'),
    ('Eric',     'Cremmeans',           'Foresters',         'PlanRight - Immediate/Graded - Issue Ages 50 - 80', '97966442', 86.14, 1033.68, '2026-05-03', 'Obiajulu Ifediora'),
    ('Scott',    'Hepfler',             'American Home Life','Final Expense',                        'AMH6312600',    217.00,  2604.00,   '2026-04-23', 'Aisha Kebbeh')
  ) AS t(client_first, client_last, carrier_name, product, policy_number, monthly, annual, eff_date, agent_full_name)
)
INSERT INTO public.deals (
  agent_id, carrier_id, client_first_name, client_last_name,
  product_sold, policy_number, monthly_premium, annual_premium,
  face_amount, effective_date, status, source, pipeline_stage, external_deal_id
)
SELECT
  (SELECT a.id FROM public.agents a
   JOIN public.profiles p ON p.id = a.profile_id
   WHERE LOWER(p.full_name) = LOWER(r.agent_full_name)
   LIMIT 1)                                                        AS agent_id,
  (SELECT c.id FROM public.carriers c
   WHERE LOWER(c.name) = LOWER(r.carrier_name) LIMIT 1)            AS carrier_id,
  r.client_first, r.client_last,
  r.product, r.policy_number,
  r.monthly, r.annual,
  r.annual * 10,                                                   -- face_amount default = 10× annual (reasonable for FE / WL)
  r.eff_date::date,
  'submitted', 'apex', 'submitted',
  r.policy_number
FROM rows r
WHERE (SELECT a.id FROM public.agents a
       JOIN public.profiles p ON p.id = a.profile_id
       WHERE LOWER(p.full_name) = LOWER(r.agent_full_name) LIMIT 1) IS NOT NULL
ON CONFLICT (policy_number) DO UPDATE SET
  monthly_premium = EXCLUDED.monthly_premium,
  annual_premium  = EXCLUDED.annual_premium,
  effective_date  = EXCLUDED.effective_date,
  updated_at      = NOW();

-- Confirm
SELECT
  count(*)::int AS deals_after_insert,
  count(*) FILTER (WHERE created_at > NOW() - INTERVAL '5 minutes')::int AS just_added,
  ROUND(SUM(annual_premium)::numeric, 2) AS total_alp_all_time,
  ROUND(SUM(annual_premium) FILTER (WHERE created_at > NOW() - INTERVAL '5 minutes')::numeric, 2) AS alp_from_this_batch
FROM public.deals;

-- List the 10 newly-inserted / updated deals with the resolved agent names
SELECT
  p.full_name AS agent,
  d.client_first_name || ' ' || d.client_last_name AS client,
  c.name AS carrier,
  d.product_sold,
  d.policy_number,
  d.monthly_premium,
  d.annual_premium,
  d.effective_date
FROM public.deals d
LEFT JOIN public.agents a ON a.id = d.agent_id
LEFT JOIN public.profiles p ON p.id = a.profile_id
LEFT JOIN public.carriers c ON c.id = d.carrier_id
WHERE d.policy_number IN (
  'ARCF26110g319','000008211854','TA-GARY-THOMAS','000008274439',
  'ARCF26110g381','POL-STEPHYOUNG','000008274359','POL-12345',
  '97966442','AMH6312600'
)
ORDER BY d.annual_premium DESC;
