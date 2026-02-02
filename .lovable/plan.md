

## Outstanding Performance Certificate Refinement

### Changes Required

#### 1. Replace "King of Sales" with "Standard of Excellence"

**Current (lines 103-111):**
- Cursive signature shows "King of Sales"
- CEO title line shows "King of Sales"

**Updated:**
- Change both instances to "Standard of Excellence"

---

#### 2. Mobile-Responsive Header Fix

**Problem:** The header "OUTSTANDING PERFORMANCE" at 38px font-size overflows on mobile screens (typically 320-414px wide).

**Solution:** Use responsive font sizing and adjusted layout:

| Element | Desktop | Mobile |
|---------|---------|--------|
| Header font | 38px | 24px |
| Padding | 60px 50px | 40px 20px |
| Letter-spacing | 3px | 1px |
| Agent name | 36px | 24px |
| Amount box | 24px | 18px |

**Technique:** Since email clients don't support media queries well, we'll use:
- Percentage-based max-width
- Smaller base fonts that scale well
- `mso-` conditional comments for Outlook
- Mobile-first approach with max-font-sizes

---

### Technical Implementation

**File: `supabase/functions/send-outstanding-performance/index.ts`**

Key HTML changes:
```html
<!-- Mobile-optimized header -->
<h1 style="font-family:Georgia,serif;font-size:28px;font-weight:bold;
           color:#1a1a1a;margin:0 0 4px 0;letter-spacing:2px;
           text-transform:uppercase;word-break:break-word;">
  OUTSTANDING
</h1>
<h1 style="font-family:Georgia,serif;font-size:28px;font-weight:bold;
           color:#1a1a1a;margin:0 0 30px 0;letter-spacing:2px;
           text-transform:uppercase;word-break:break-word;">
  PERFORMANCE
</h1>

<!-- Signature with "Standard of Excellence" -->
<p style="font-family:'Brush Script MT','Lucida Handwriting',cursive;
          font-size:28px;color:#333333;margin:0 0 5px 0;">
  Standard of Excellence
</p>
<p style="font-size:12px;color:#666666;margin:0;line-height:1.6;">
  Standard of Excellence<br>
  Chief Executive Officer<br>
  APEX Financial Group
</p>
```

**Additional Mobile Refinements:**
- Reduce container padding to `padding:40px 25px`
- Use `width:100%` with `max-width:700px` for fluid scaling
- Reduce agent name font to 28px
- Reduce amount box font to 20px
- Add `word-break:break-word` to prevent overflow

---

### Expected Result

The certificate will now:
1. Display **"Standard of Excellence"** as the signatory name
2. Render cleanly on mobile devices (iPhone, Android) without text overflow
3. Maintain the premium, executive appearance on desktop
4. Scale proportionally across all screen sizes

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/send-outstanding-performance/index.ts` | Update HTML template with mobile-responsive fonts and "Standard of Excellence" |

