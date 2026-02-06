

# Plan: Simplify Call Center Actions + Contracted Modal Integration

## Summary

Streamline the Call Center workflow by:
1. **Remove "Contacted" button** - Merge its functionality into "Hired"
2. **"Hired" marks as contacted** - Starts the 2-week timeline
3. **"Contracted" opens modal** - Shows contracting link input (like Add Agent flow) and creates the agent record
4. **Keep "Bad Applicant"** - For rejecting poor leads
5. **Clean, efficient 3-button layout**

---

## Current vs. New Flow

| Current (4 buttons) | New (3 buttons) |
|---------------------|-----------------|
| Contacted → Hired → Contracted → Bad Applicant | Hired → Contracted → Bad Applicant |

**New Flow:**
```text
┌─────────────────────────────────────────┐
│                                         │
│   ✓ Hired          📋 Contracted        │
│   (Marks contacted, (Opens modal,       │
│    starts 2-week    creates agent,      │
│    countdown)       sends email)        │
│                                         │
│              ✕ Bad Applicant            │
│              (Reject lead)              │
│                                         │
│           [ Skip to Next → ]            │
└─────────────────────────────────────────┘
```

---

## Files to Modify

### 1. `src/components/callcenter/CallCenterActions.tsx`

**Changes:**
- Remove "contacted" action from the array
- Update keyboard hints from `1-4` to `1-3`
- Update key bindings: 1=Hired, 2=Contracted, 3=Bad Applicant
- Add `onContracted` callback prop for opening the modal
- Use a cleaner 3-column layout or 2+1 layout

**New Action IDs:**
```typescript
export type ActionId = "hired" | "contracted" | "bad_applicant";
```

**New Actions Array:**
```typescript
const actions: ActionDef[] = [
  {
    id: "hired",
    label: "Hired",
    icon: CheckCircle2,
    color: "text-green-400",
    gradient: "from-green-500/20 to-emerald-500/20 ...",
    key: "1",
    description: "Contacted & interested",
  },
  {
    id: "contracted",
    label: "Contracted",
    icon: FileText,
    color: "text-blue-400",
    gradient: "from-blue-500/20 to-indigo-500/20 ...",
    key: "2",
    description: "Ready to onboard",
  },
  {
    id: "bad_applicant",
    label: "Not a Fit",
    icon: XCircle,
    color: "text-red-400",
    gradient: "from-red-500/10 to-rose-500/10 ...",
    key: "3",
    description: "Reject applicant",
  },
];
```

### 2. `src/pages/CallCenter.tsx`

**Changes:**
- Add `ContractedModal` import and state management
- Remove "contacted" case from `handleAction`
- When "contracted" is clicked, open the ContractedModal instead of immediate action
- On modal success, remove lead from list and show success message
- Update keyboard bindings (remove "1" for contacted, shift others)

**New State:**
```typescript
const [showContractedModal, setShowContractedModal] = useState(false);
```

**New Handler:**
```typescript
const handleAction = useCallback(async (actionId: ActionId) => {
  if (actionId === "contracted") {
    // Open the modal instead of immediate processing
    setShowContractedModal(true);
    return;
  }
  
  // ... rest of existing logic for hired/bad_applicant
}, [currentLead]);
```

**Keyboard Shortcuts Update:**
```typescript
switch (e.key.toLowerCase()) {
  case "1":
    handleAction("hired");
    break;
  case "2":
    handleAction("contracted");
    break;
  case "3":
    handleAction("bad_applicant");
    break;
  // ...
}
```

### 3. `src/components/dashboard/ContractedModal.tsx`

**Changes:**
- Make it compatible with both `applications` and `aged_leads` sources
- Add a `source` prop to determine which table to update
- Ensure it works with the unified lead structure from Call Center

**Updated Props:**
```typescript
interface ContractedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    license_status: "licensed" | "unlicensed" | "pending";
    license_progress?: string | null;
    source?: "applications" | "aged_leads"; // NEW
  };
  agentId: string;
  onSuccess?: () => void;
}
```

---

## Visual Design (Clean 3-Button Layout)

```text
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐   │
│  │         ✓ HIRED         │  │       📋 CONTRACTED      │   │
│  │    Contacted & Ready    │  │     Enter CRM Link       │   │
│  │          [1]            │  │          [2]             │   │
│  └─────────────────────────┘  └─────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    ✕ NOT A FIT                         │  │
│  │                   Reject Applicant [3]                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│                  [ Skip to Next → ] [N]                     │
│                                                              │
│      Press R to record • 1-3 for actions • N skip • ESC     │
└──────────────────────────────────────────────────────────────┘
```

---

## Implementation Flow

### When "Hired" is Clicked:
1. Mark lead as contacted (`contacted_at = now()`)
2. Update status to "reviewing" (applications) or "contacted" (aged_leads)
3. Send follow-up email
4. Remove from current queue
5. Lead now appears in "Contacted" filter with 2-week countdown active

### When "Contracted" is Clicked:
1. Open ContractedModal
2. User enters/selects contracting link
3. On submit:
   - Mark application as contracted
   - Create new agent profile + record
   - Send contracted email with CRM link
   - Remove lead from queue
4. Success toast: "Agent contracted and added to CRM!"

### When "Bad Applicant" is Clicked:
1. Mark as rejected/bad_applicant
2. Remove from queue
3. No email sent

---

## Summary of Changes

| File | Action |
|------|--------|
| `src/components/callcenter/CallCenterActions.tsx` | Remove "contacted", update to 3-button layout, update keyboard hints |
| `src/pages/CallCenter.tsx` | Add modal state, handle "contracted" specially, update keyboard bindings |
| `src/components/dashboard/ContractedModal.tsx` | Add source prop support for aged_leads |

---

## Expected Result

- **Cleaner UI**: 3 clear action buttons instead of 4
- **Better workflow**: "Hired" = contacted, "Contracted" = ready to onboard (opens modal)
- **Full integration**: Contracted modal creates the agent record with CRM link
- **Keyboard shortcuts**: 1-Hired, 2-Contracted, 3-Bad Applicant, N-Skip, ESC-Exit

