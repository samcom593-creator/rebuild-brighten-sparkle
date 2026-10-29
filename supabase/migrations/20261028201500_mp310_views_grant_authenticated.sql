-- MP-310's six views were created without SELECT for authenticated, so every signed-in read failed
-- with "permission denied": Call Training showed nothing, Book of Business call panels stayed empty,
-- and Sold Calls never knew which calls were in the book. All six are security_invoker, so the base
-- tables' RLS still decides the rows. Tested in a rolled-back transaction on 2026-10-28: Sam reads
-- 1995 / 1823 / 1995 / 474 / 30 / 478 rows, an ordinary signed-in user reads 0 on every view.
grant select on
  public.v_book_row_call_detail,
  public.v_book_row_call_summary,
  public.v_book_row_calls,
  public.v_call_training,
  public.v_call_training_agents,
  public.v_sold_call_book_match
to authenticated;
