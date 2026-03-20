-- Delete Samuel James 03/19 record (1400 AOP, 0 deals - should not exist)
DELETE FROM daily_production WHERE id = '398c1fc6-ec8f-426d-aa35-9d11c94b0e48';

-- Delete Aisha Kebbeh 03/17 record (696 AOP, 2 deals - no deals on that date per carrier data)
DELETE FROM daily_production WHERE id = '031f5725-6d0b-4408-a5ec-8ee2cfe57804';

-- Fix Chukwudi Ifediora 03/16 rounding (1079.00 → 1079.64)
UPDATE daily_production SET aop = 1079.64 WHERE id = '743a148b-cf5a-4432-b35c-55d34a5f43cb';