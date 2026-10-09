#!/usr/bin/env python3
"""One-off: rewrite Sam's My Day weekly plan (2026-10-08). Arizona time throughout.

Reversible: the previous rows are DEACTIVATED, not deleted, and a JSON snapshot sits in
~/business-ops/myday-backups/day_plan_tasks-2026-10-08-before.json.
Prints SQL on stdout; apply it with bot-sql in one transaction.

Sam's rules, all in the output:
  wake/gym kept; 7:00 clip block with a clip type per weekday; 7:30 shower + breakfast;
  two 1-hour lead-message blocks; team meeting 11:30 AM Central (= 9:30 AM Arizona while Chicago is on
  daylight time); sales calls 2 h; recruiting calls; a 3 h block that fits 3-4 videos; leadership 1 h at 5 PM;
  production review every ~3 days (Mon, Thu, Sun); Wednesday is the pre-licensing push day;
  asleep by 11:30 PM.
"""
SAM = "71826bba-5577-4810-a226-1f6f2ad5288a"

CLIP = {
    1: ("Record a clip: Monday check-in",
        "60-90 sec to camera. Where the agency stands, this week's one target, one thing you owe the team. Raw, one take, no editing."),
    2: ("Record a clip: gym or lift PR",
        "Film the heaviest or last set from this morning. Put the number on screen. Hook: the weight, then the reaction."),
    3: ("Record a clip: inspiration",
        "One lesson you needed at 18 that someone at 18 needs today. Under 60 sec, one take. Faith-aware, never preachy."),
    4: ("Record a clip: PR or production win",
        "Say the number: a record week, a hire, a deal. Show proof on screen if you have it. 30-45 sec."),
    5: ("Record a clip: transformation",
        "Then vs now: broke vs today, or the body change. 30-45 sec, end on the standard."),
}
THEME = {1: "The Build: day in the life", 2: "Money moves", 3: "Get better: self-improvement",
         4: "Mindset and faith: identity", 5: "Fitness: body and discipline"}
GYM = {1: "Legs or push. Film nothing, train.", 2: "Heavy day. Film the top set for the clip.", 3: "Pull. Film nothing, train.",
       4: "Upper body. Hit a number you can say out loud.", 5: "Fitness day. Film 2 gym Shorts."}

def rows_for(wd):
    r = []
    def add(start, dur, cat, title, detail=None, alert=True):
        r.append((start, dur, cat, title, detail, alert))
    add(330, 30, "faith", "Wake up + quiet time + top 3", "Water, prayer or quiet, read today's top 3.")
    add(360, 60, "health", "Gym", GYM[wd])
    add(420, 30, "content", CLIP[wd][0], CLIP[wd][1])
    add(450, 30, "health", "Shower + breakfast", None)
    add(480, 60, "sales", "Lead messages #1", "Answer pure lead messages only. Nothing else open.")
    add(540, 30, "planning", "Prep: team agenda + script today's videos", "Write the 3 numbers for the meeting. Outline today's videos so recording is just talking.")
    add(570, 30, "leadership", "Team meeting (11:30 AM Central)", "Wins, numbers, today's target. Same start time every day, you lead it.")
    add(600, 120, "sales", "Sales calls", "Dial. Between calls drop video ideas into the Launch Board. Do not polish anything.")
    add(720, 30, "health", "Lunch", None, alert=False)
    if wd == 3:
        add(750, 90, "recruiting", "Pre-licensing push day", "Open the Pre-licensing check on this page. Everyone in the Slack must be confirmed done or chased right now.")
    else:
        add(750, 90, "recruiting", "Recruiting calls", "Licensed Inbox, Get going lane first (never contacted), then gone quiet 14d+.")
    add(840, 180, "content", f"Record 3-4 videos: {THEME[wd]}", "Fits 3-4: one long-form plus educational videos. Record straight through. Tap +1 Long-form posted when it goes live.")
    add(1020, 60, "leadership", "Leadership call", "Team calls, wins, accountability.")
    add(1080, 60, "rest", "Dinner + family", None, alert=False)
    add(1140, 60, "sales", "Lead messages #2", "Second pass on pure lead messages.")
    add(1200, 30, "content", "Approve edits + pick tomorrow's video", "Review the long-form edit, choose tomorrow's topic.")
    if wd in (1, 4):
        add(1230, 30, "ceo", "Production review", "Deals, ALP, hires, long-forms posted: this stretch vs the last three days.")
    add(1260, 30, "learning", "Watch Later: 1 video, 1 idea", "Save the idea to the Launch Board.")
    add(1290, 30, "planning", "Shutdown: inbox zero + tomorrow's top 3", None)
    add(1320, 60, "rest", "Wind down: phone down", "Lights low. Asleep by 11:30.")
    add(1380, 30, "rest", "In bed, lights out", "Asleep by 11:30 sharp.")
    add(1410, 360, "rest", "Sleep", "Asleep by 11:30 PM, up at 5:30 AM.", alert=False)
    return r

def q(s): return "'" + s.replace("'", "''") + "'"

out = ["begin;"]
out.append(f"update day_plan_tasks set active=false, updated_at=now() where user_id='{SAM}' and weekday between 1 and 5 and active;")
for wd in range(1, 6):
    for i, (start, dur, cat, title, detail, alert) in enumerate(rows_for(wd)):
        out.append(
            "insert into day_plan_tasks (user_id, weekday, start_min, duration_min, title, detail, category, sort, active, alert) "
            f"values ('{SAM}', {wd}, {start}, {dur}, {q(title)}, {q(detail) if detail else 'null'}, {q(cat)}, {i}, true, {str(alert).lower()});")
# weekends: sleep protects 11:30; Sunday gets a production review
for wd in (6, 7):
    out.append(f"update day_plan_tasks set start_min=1410, duration_min=360, title='Sleep', detail='Asleep by 11:30 PM.', alert=false, updated_at=now() "
               f"where user_id='{SAM}' and weekday={wd} and active and title like 'Sleep%';")
out.append(f"update day_plan_tasks set duration_min=150, updated_at=now() where user_id='{SAM}' and weekday=7 and active and start_min=1080 and title='Free time';")
out.append("insert into day_plan_tasks (user_id, weekday, start_min, duration_min, title, detail, category, sort, active, alert) "
           f"values ('{SAM}', 7, 1230, 60, 'Production review', 'Deals, ALP, hires, long-forms posted: this stretch vs the last three days.', 'ceo', 50, true, true);")
out.append("commit;")
print("\n".join(out))
