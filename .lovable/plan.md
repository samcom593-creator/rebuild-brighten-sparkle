

# Plan: Update Call Center Pipeline Stages + Test Date Scheduler

## Summary

Replace the current Call Center pipeline stages with license-progress-focused stages that reflect the actual licensing journey:
- Started (just bought course)
- Finished Course
- Test Scheduled (with date picker)
- Fingerprints
- Waiting on License

Plus add the ability to schedule/view test dates when at the "Test Scheduled" stage.

---

## Database Changes

Add a new column to the `applications` table to track test scheduling:

| Column | Type | Purpose |
|--------|------|---------|
| `test_scheduled_date` | `date` | When the licensing test is scheduled |

Also, we need to expand the `license_progress` enum to include more granular steps:
- Add: `finished_course`, `test_scheduled`, `fingerprints_done`

**Migration SQL:**
```sql
-- Add test scheduled date column
ALTER TABLE applications
ADD COLUMN test_scheduled_date date;

-- Add new enum values for more granular progress tracking
ALTER TYPE license_progress ADD VALUE IF NOT EXISTS 'finished_course' AFTER 'course_purchased';
ALTER TYPE license_progress ADD VALUE IF NOT EXISTS 'test_scheduled' AFTER 'finished_course';
ALTER TYPE license_progress ADD VALUE IF NOT EXISTS 'fingerprints_done' AFTER 'passed_test';
```

---

## Files to Modify

### 1. `src/components/callcenter/CallCenterStageSelector.tsx`

Complete overhaul to use license progress stages instead of application status:

**New Stages:**
| Stage ID | Label | Icon | Color |
|----------|-------|------|-------|
| `course_purchased` | Course Started | BookOpen | Blue |
| `finished_course` | Finished Course | BookCheck | Indigo |
| `test_scheduled` | Test Scheduled | CalendarClock | Purple |
| `passed_test` | Passed Test | FileCheck | Violet |
| `fingerprints_done` | Fingerprints | Fingerprint | Teal |
| `waiting_on_license` | Waiting on License | Clock | Orange |
| `licensed` | Licensed | Award | Green |

**Changes:**
- Rename type from `PipelineStage` to `LicensingStage`
- Update stages array with new licensing-focused options
- Add conditional rendering for test date picker when `test_scheduled` is selected
- Add props for `testScheduledDate` and `onTestDateChange`

### 2. `src/components/callcenter/CallCenterLeadCard.tsx`

**Changes:**
- Pass `licenseProgress` (from applications.license_progress) instead of status
- Add `testScheduledDate` to the UnifiedLead interface
- Pass test date props to CallCenterStageSelector
- Update the `statusToStage` function to use `license_progress` values

### 3. `src/pages/CallCenter.tsx`

**Changes:**
- Fetch `license_progress` and `test_scheduled_date` in the query
- Add handler for test date changes
- Update lead mapping to include new fields

### 4. `src/components/dashboard/LicenseProgressSelector.tsx`

**Changes:**
- Add the new enum values (`finished_course`, `test_scheduled`, `fingerprints_done`)
- Add ability to set test date when clicking "Test Scheduled"
- Add date display for scheduled tests

---

## New Call Center Stage Selector Design

```text
+----------------------------------------------------------+
|  Licensing Progress                                       |
|  +------------------------------------------------------+|
|  | [▼ Finished Course]                                  ||
|  +------------------------------------------------------+|
|                                                          |
|  Progress Bar:                                           |
|  [===][===][===][   ][   ][   ][   ]                     |
|   ↑     ↑     ↑                                          |
|  Started Course Test                                     |
|                                                          |
|  When "Test Scheduled" is selected:                      |
|  +------------------------------------------------------+|
|  | 📅 Test Date: Feb 15, 2025          [Change Date]   ||
|  +------------------------------------------------------+|
+----------------------------------------------------------+
```

---

## Technical Implementation

### Updated Stage Selector Component

```typescript
export type LicensingStage = 
  | "course_purchased"
  | "finished_course"
  | "test_scheduled"
  | "passed_test"
  | "fingerprints_done"
  | "waiting_on_license"
  | "licensed";

const stages: StageDef[] = [
  { id: "course_purchased", label: "Course Started", icon: BookOpen, color: "text-blue-400", bgColor: "bg-blue-500/20" },
  { id: "finished_course", label: "Finished Course", icon: BookCheck, color: "text-indigo-400", bgColor: "bg-indigo-500/20" },
  { id: "test_scheduled", label: "Test Scheduled", icon: CalendarClock, color: "text-purple-400", bgColor: "bg-purple-500/20" },
  { id: "passed_test", label: "Passed Test", icon: FileCheck, color: "text-violet-400", bgColor: "bg-violet-500/20" },
  { id: "fingerprints_done", label: "Fingerprints", icon: Fingerprint, color: "text-teal-400", bgColor: "bg-teal-500/20" },
  { id: "waiting_on_license", label: "Waiting on License", icon: Clock, color: "text-orange-400", bgColor: "bg-orange-500/20" },
  { id: "licensed", label: "Licensed", icon: Award, color: "text-green-400", bgColor: "bg-green-500/20" },
];
```

### Test Date Picker (shown when test_scheduled is selected)

```typescript
{currentStage === "test_scheduled" && (
  <div className="mt-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
    <label className="text-xs text-muted-foreground mb-2 block">
      Test Scheduled Date
    </label>
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start">
          <CalendarIcon className="h-4 w-4 mr-2" />
          {testScheduledDate 
            ? format(new Date(testScheduledDate), "MMM d, yyyy")
            : "Select date"
          }
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <Calendar
          mode="single"
          selected={testScheduledDate ? new Date(testScheduledDate) : undefined}
          onSelect={(date) => onTestDateChange?.(date)}
        />
      </PopoverContent>
    </Popover>
  </div>
)}
```

---

## Data Flow

```text
User selects stage → onStageChange called
                  ↓
If "test_scheduled" → Show date picker
                  ↓
User picks date → onTestDateChange called
                  ↓
CallCenter updates applications table:
  - license_progress = new stage
  - test_scheduled_date = selected date (if applicable)
                  ↓
Lead card refreshes with new data
```

---

## Expected Outcomes

After implementation:
1. **License-focused stages** - Pipeline shows licensing journey: Course Started → Finished Course → Test Scheduled → Passed Test → Fingerprints → Waiting on License → Licensed
2. **Test date scheduler** - When selecting "Test Scheduled", a date picker appears to set when the test is scheduled
3. **Visual feedback** - Test date displays on the lead card when set
4. **Filter integration** - The existing license progress filter will work with the new stages
5. **Data persistence** - Test scheduled dates saved to the applications table

