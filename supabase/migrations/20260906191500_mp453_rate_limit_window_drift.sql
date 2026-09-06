-- MP-453 — the rate limiter counted one window as two, so every limit was up to 2x
--
-- FOUND BY PROBING IT, NOT BY READING IT. MP-453 wired send-password-reset into
-- check_rate_limit and then fired 8 requests at a per-email max of 3. The refusals
-- came at calls 6 and 8 — and call 7, fired between two refusals, SUCCEEDED. A
-- limiter that refuses, then allows, then refuses is not enforcing a ceiling.
--
-- ROOT CAUSE, one line:
--   date_trunc('second', now())                 FLOORS to the second
--   extract(epoch from now())::bigint           ROUNDS half-up (numeric -> bigint)
-- so whenever the fractional second is >= 0.5 the two disagree by exactly one
-- second and the derived window_start lands one second earlier than the
-- floor-consistent one. Requests seconds apart therefore scatter across TWO
-- adjacent rows — observed live, same bucket_key holding window_start
-- 18:59:59+00 (count 2) and 19:00:00+00 (count 3) at the same instant.
--
-- Each half counts independently, so the effective ceiling is up to 2x the
-- configured _max_requests and the refusal is non-monotonic: a caller refused by
-- the exhausted bucket succeeds on its next call if that one rounds into the
-- other. The window boundary also fails to be stable across calls, which is the
-- property the whole mechanism rests on.
--
-- BLAST RADIUS is not one function: 14 edge functions pass rateLimit through
-- _shared/handler.ts and 2 more call this RPC directly, so all 16 have been
-- enforcing roughly half the limit they declare, since the function shipped.
--
-- THE FIX derives the window from ONE flooring operation on the epoch, so no
-- second source of truth exists to disagree with. Signature, semantics, table
-- and return type are unchanged, so no caller needs to know.
--
-- NOT CLAIMED: this makes the limits correct, not strict. Windows are fixed
-- calendar buckets rather than a sliding window, so a caller can still spend a
-- full allowance at the end of one bucket and another at the start of the next.
-- That was true before and remains true; it is a known property of this design,
-- stated rather than quietly inherited.

CREATE OR REPLACE FUNCTION public.check_rate_limit(_bucket_key text, _max_requests integer, _window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _window_start TIMESTAMPTZ;
  _current_count INTEGER;
BEGIN
  -- One flooring operation, one source of truth for the bucket boundary.
  _window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / _window_seconds) * _window_seconds
  );

  INSERT INTO public.rate_limits (bucket_key, window_start, request_count)
  VALUES (_bucket_key, _window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET request_count = public.rate_limits.request_count + 1
  RETURNING request_count INTO _current_count;

  -- Cleanup old windows (best effort)
  DELETE FROM public.rate_limits WHERE window_start < (now() - interval '1 hour');

  RETURN _current_count <= _max_requests;
END;
$function$;
