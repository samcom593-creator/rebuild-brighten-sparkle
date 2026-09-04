-- MP-426: exact Vantage Discord messages supersede the September estimate.
--
-- Sam's September 3 relay preserved "about $2,000 yesterday" as a one-policy
-- September 2 agency placeholder while the Discord reader was unavailable.
-- The source channel now proves three exact, named facts instead:
--   1545052246897725484  Marquay Vaughns  $2,002  2026-09-03
--   1545083481569235006  Marquay Vaughns  $2,043  2026-09-03
--   1545502341275586661  Pranav Kodali    $2,820  2026-09-04
-- They were settled through ingest_discord_production_deal, including durable
-- ordinal-zero receipts. Keep the original estimate row for audit, but reduce
-- its contribution to zero so dashboards count only source-attested policies.

begin;

select public.ingest_discord_production_deal(
  p_source => 'discord_vantage_agentcloud',
  p_guild_id => '1537486129224224830',
  p_channel_id => '1537486131329896506',
  p_message_id => '1545052246897725484',
  p_deal_ordinal => 0,
  p_agent_id => '021f1686-2560-4b05-9281-c3a66d23c1f2',
  p_agent_name => 'Marquay Vaughns',
  p_carrier => 'Newbridge',
  p_product => 'Life',
  p_policy_number => null,
  p_monthly_premium => 167,
  p_annual_premium => 2002,
  p_face_amount => 26000,
  p_occurred_at => '2026-09-03T12:46:01.343Z',
  p_posted_date => date '2026-09-03',
  p_content_sha256 => 'efea90e86ccacafded4d91836cef364635a3d6019269eac370a299754ba10921',
  p_metadata => jsonb_build_object(
    'parse_version', 'discord-deal-v1',
    'discord_webhook_id', '1538629155594182879',
    'source_capture', 'Vantage daily-sales message link verified 2026-09-04'
  )
)
where exists (
  select 1 from public.agents
  where id = '021f1686-2560-4b05-9281-c3a66d23c1f2'::uuid
);

select public.ingest_discord_production_deal(
  p_source => 'discord_vantage_agentcloud',
  p_guild_id => '1537486129224224830',
  p_channel_id => '1537486131329896506',
  p_message_id => '1545083481569235006',
  p_deal_ordinal => 0,
  p_agent_id => '021f1686-2560-4b05-9281-c3a66d23c1f2',
  p_agent_name => 'Marquay Vaughns',
  p_carrier => 'Combined',
  p_product => 'Life',
  p_policy_number => null,
  p_monthly_premium => 170,
  p_annual_premium => 2043,
  p_face_amount => 20000,
  p_occurred_at => '2026-09-03T14:50:08.269Z',
  p_posted_date => date '2026-09-03',
  p_content_sha256 => '4e21acd5a0354b6611a4e1496ffc93d6262172a65b77aade429339cbbdb6cef5',
  p_metadata => jsonb_build_object(
    'parse_version', 'discord-deal-v1',
    'discord_webhook_id', '1538629155594182879',
    'source_capture', 'Vantage daily-sales message link verified 2026-09-04'
  )
)
where exists (
  select 1 from public.agents
  where id = '021f1686-2560-4b05-9281-c3a66d23c1f2'::uuid
);

select public.ingest_discord_production_deal(
  p_source => 'discord_vantage_agentcloud',
  p_guild_id => '1537486129224224830',
  p_channel_id => '1537486131329896506',
  p_message_id => '1545502341275586661',
  p_deal_ordinal => 0,
  p_agent_id => '20344eff-2a14-4b9f-bae2-fabc87f55c07',
  p_agent_name => 'Pranav Kodali',
  p_carrier => 'Ethos',
  p_product => 'Whole Life',
  p_policy_number => null,
  p_monthly_premium => 235,
  p_annual_premium => 2820,
  p_face_amount => 20000,
  p_occurred_at => '2026-09-04T18:34:32.205Z',
  p_posted_date => date '2026-09-04',
  p_content_sha256 => 'fbe0a865cc0d71df8466cf16b9fe4e4fa98d9b966f548b7250fc37b861036e40',
  p_metadata => jsonb_build_object(
    'parse_version', 'discord-deal-v1',
    'discord_webhook_id', '1538629155594182879',
    'source_capture', 'Vantage daily-sales message link verified 2026-09-04'
  )
)
where exists (
  select 1 from public.agents
  where id = '20344eff-2a14-4b9f-bae2-fabc87f55c07'::uuid
);

update public.production_external_daily_snapshots
set reported_policies = 0,
    reported_alp = 0,
    metadata = metadata || jsonb_build_object(
      'superseded_at', now(),
      'superseded_reason', 'exact named Discord messages settled by MP-426',
      'superseding_message_ids', jsonb_build_array(
        '1545052246897725484',
        '1545083481569235006',
        '1545502341275586661'
      )
    ),
    updated_at = now()
where agency_name = 'Vantage Financial'
  and business_date = date '2026-09-02'
  and source = 'discord_vantage_owner_report'
  and external_ref = 'sam-relay:2026-09-03:vantage:2026-09-02'
  and (
    select count(*)
    from public.discord_deal_ingestion_receipts r
    where r.deal_ordinal = 0
      and r.status in ('ingested', 'duplicate')
      and r.message_id in (
        '1545052246897725484',
        '1545083481569235006',
        '1545502341275586661'
      )
  ) = 3;

commit;
