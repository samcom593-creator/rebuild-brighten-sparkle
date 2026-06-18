-- 2026-06-18 Sam directive (verbatim): "yes add all there numbers even tau"
-- (continuation of: "Make sure you're picking up every single agent in their
-- number- ... Daniel's numbers says he's at for the last thirty days,
-- nineteen thousand. Why are you not picking him up as an agent? Make sure
-- you're picking up every single agent in their number.")
--
-- Backfill agents.al_user_id by matching against agentlink_agents:
--
-- Pass 1: email-equal (strongest signal). Backfilled 4 agents:
--   Joselito Lafrance (900) · Sarvin Arolova (902) · Lilly Contreras (891)
--   · Benny Vazquez (828).
--
-- Pass 2: first_name + last_name lowercase-equal. Backfilled 3 more:
--   Mahmod Imran (280 → same as Moody Imran nickname — DUP)
--   Grey Bowman (582) · Kaeden Vaughns (352).
--
-- After backfill: caught that Mahmod Imran al_user=280 collided with Moody
-- Imran al_user=280 — same person, two records. Canonicalized Mahmod to
-- Moody (set canonical_agent_id, cleared al_user_id) so book-of-business
-- doesn't double-count.
--
-- Result: leaderboard went from showing Mahmod + Moody both as 38 deals/
-- \$45,011 to just Moody as #1 (correct). Plus 6 producers (Grey, Kaeden,
-- Mahmod-via-Moody, Joselito, Sarvin, Benny, Lilly) now appear in book-truth
-- views.
--
-- 31 licensed actives remain unlinked. They appear in v_agents_missing_al_link
-- — Sam needs to manually map them OR they need to be invited to AgentLink.
--
-- rollback: UPDATE agents SET al_user_id = NULL WHERE id IN (...the 7 above);
--           UPDATE agents SET canonical_agent_id = NULL WHERE display_name =
--             'Mahmod Imran';

-- This migration documents the in-session backfill; the actual UPDATEs
-- already landed via bot-sql so re-applying is a no-op (al_user_id
-- already set on these agents).

DO $$
BEGIN
  -- Idempotent re-apply of the email-match backfill.
  WITH email_matches AS (
    SELECT a.id AS agent_id, ala.insuracloud_user_id
    FROM public.agents a
    JOIN public.profiles p ON p.user_id = a.user_id
    JOIN public.agentlink_agents ala ON lower(ala.email) = lower(p.email)
    WHERE a.al_user_id IS NULL
      AND a.canonical_agent_id IS NULL
      AND COALESCE(a.is_deactivated, false) = false
      AND ala.insuracloud_user_id IS NOT NULL
  )
  UPDATE public.agents a
  SET al_user_id = m.insuracloud_user_id, updated_at = now()
  FROM email_matches m
  WHERE a.id = m.agent_id;

  -- Idempotent re-apply of the name-match backfill.
  WITH name_matches AS (
    SELECT DISTINCT ON (a.id) a.id AS agent_id, ala.insuracloud_user_id
    FROM public.agents a
    JOIN public.agentlink_agents ala
      ON lower(trim(ala.first_name)) = lower(trim(split_part(a.display_name, ' ', 1)))
     AND lower(trim(ala.last_name)) = lower(trim(split_part(a.display_name, ' ', array_length(string_to_array(a.display_name, ' '), 1))))
    WHERE a.al_user_id IS NULL
      AND a.canonical_agent_id IS NULL
      AND COALESCE(a.is_deactivated, false) = false
      AND ala.insuracloud_user_id IS NOT NULL
  )
  UPDATE public.agents a
  SET al_user_id = m.insuracloud_user_id, updated_at = now()
  FROM name_matches m
  WHERE a.id = m.agent_id;
END $$;

-- Document Mahmod → Moody dedupe (idempotent — only fires if Mahmod isn't
-- already canonicalized).
UPDATE public.agents
SET canonical_agent_id = (SELECT id FROM public.agents WHERE display_name = 'Moody Imran' AND agent_code = 'MOOAF13'),
    al_user_id = NULL,
    updated_at = now()
WHERE display_name = 'Mahmod Imran'
  AND canonical_agent_id IS NULL;

COMMENT ON COLUMN public.agents.al_user_id IS
'2026-06-18 backfill: 7 agents linked via email + name match against
agentlink_agents.insuracloud_user_id. Mahmod Imran (nickname) collapsed
into Moody Imran (canonical). 31 agents remain unlinked — see
v_agents_missing_al_link.';
