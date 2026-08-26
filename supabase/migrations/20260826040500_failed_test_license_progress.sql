-- The UI has displayed “Failed Test · Retake” for months, but the enum never
-- accepted that value. Add the missing canonical milestone in its own migration
-- so it is committed before later functions cast text into the enum.
alter type public.license_progress add value if not exists 'failed_test' after 'test_scheduled';
