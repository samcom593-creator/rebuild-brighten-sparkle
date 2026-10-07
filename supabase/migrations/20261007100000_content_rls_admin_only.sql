-- Launch Board data is invite-only (ContentAccessGate admits admins and content_access
-- invitees), but the *_admin_all policies on content_cards and content_posts also
-- admitted every 'manager' for ALL commands. Measured 2026-10-07 as a manager without an
-- invite (rolled back): saw 34 cards and 368 posts, could move a card and delete posts.
-- The invited policies (content_can_access(), which includes admins) stay as they are.
alter policy content_cards_admin_all on public.content_cards
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));
alter policy content_posts_admin_all on public.content_posts
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));
