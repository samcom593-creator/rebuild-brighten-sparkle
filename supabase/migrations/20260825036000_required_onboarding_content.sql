-- Put the owner's required onboarding material at the front of the tracked
-- course. Existing progress stays attached to the same module ids.

begin;

update public.onboarding_modules
set title = 'Start Here: APEX Onboarding',
    description = 'Required orientation before scripts, objections, and field training.',
    video_url = 'https://youtu.be/Gm62pf3SywU',
    order_index = 0,
    is_active = true
where id = '262a15a3-463b-48d7-965f-9ec18b5a8567'::uuid;

update public.onboarding_modules
set title = 'Official Script Walkthrough',
    description = 'Learn the approved APEX presentation flow before taking live appointments.',
    video_url = 'https://drive.google.com/file/d/1FZIMIdqDRf7HAox9egfVWpAvhterF2Vy/view?ts=6a8d0638',
    order_index = 1,
    is_active = true
where id = 'fe1ebd29-c76c-4bf3-a5d4-fb80f39960e1'::uuid;

update public.onboarding_modules
set title = 'Handling Objections',
    description = 'Required objection handling practice before field training.',
    video_url = 'https://www.youtube.com/watch?v=jOtqBnnLsR0',
    order_index = 2,
    is_active = true
where id = '3d16a8a8-02be-4ebe-8fb3-2c0301df0fa0'::uuid;

commit;
