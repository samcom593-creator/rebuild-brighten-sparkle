-- Add test scheduled date column to applications
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS test_scheduled_date date;

-- Add new enum values for more granular license progress tracking
ALTER TYPE license_progress ADD VALUE IF NOT EXISTS 'finished_course' AFTER 'course_purchased';
ALTER TYPE license_progress ADD VALUE IF NOT EXISTS 'test_scheduled' AFTER 'finished_course';
ALTER TYPE license_progress ADD VALUE IF NOT EXISTS 'fingerprints_done' AFTER 'passed_test';