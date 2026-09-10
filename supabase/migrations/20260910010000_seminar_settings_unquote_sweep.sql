-- MP-498 follow-up: the sweep stopped one row short, so the confirmation email
-- was still broken after the public page was fixed.
--
-- 20260910003000 unquoted seminar_meeting_url{,_label} for the public /seminar
-- CTA. But seminar-confirmation (ACTIVE v151) builds TWO hrefs from
-- seminar_zoom_url in the booking-confirmation email:
--
--   <a href="${settings.zoomUrl}">   -- index.ts:435 and :442, "Join the Zoom"
--
-- With the value stored as "https://..." including its quote characters, the
-- attribute terminates at the second quote and the href is the EMPTY STRING --
-- a dead button in the email a registrant gets the moment they book. The same
-- rows also render their quotes as visible text via sanitizeHtml() for
-- Meeting ID and Passcode.
--
-- MP-345's lesson is that a sweep stopping at the instance you noticed IS the
-- instance, not the class. This finishes the seminar_* keys.
--
-- Idempotent: the predicate only matches a still-quoted value.
--
-- DELIBERATELY NOT SWEPT, and recorded rather than fixed: 8 further quoted rows
-- remain (manychat_api_token, insuracloud_api_token, insuracloud_api_base_url,
-- telegram_{invite_url,webhook_url,webhook_set_at,bot_id}, apex_bots_primary_host).
-- Those are credentials and integration endpoints, and unquoting one is not
-- obviously safe: MP-... recorded that the insuracloud al_ token being unusable
-- is the ONLY thing preventing sweepUnsynced() from POSTing 1,667 duplicate
-- policies into the book commissions are computed from -- an accident, not a
-- safety property. Repairing that credential ARMS a destructive path. It needs
-- its own wave with that write path gated first.

update public.system_settings
   set value = btrim(value, '"')
 where key in (
   'seminar_zoom_url',
   'seminar_zoom_meeting_id',
   'seminar_passcode',
   'seminar_booking_method'
 )
   and value like '"%"';
