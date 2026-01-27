

# Fix Missing Pages & Add "Remember Me" to Login

## Overview

This plan addresses the broken footer links and adds "Remember Me" functionality to ensure all authentication flows are consistent across the application.

## Issues Identified

| Issue | Current State | Solution |
|-------|---------------|----------|
| Footer `/privacy` link | 404 - Page not found | Create Privacy Policy page |
| Footer `/terms` link | 404 - Page not found | Create Terms of Service page |
| Footer `/disclosures` link | 404 - Page not found | Create Disclosures page |
| `/login` "Remember Me" | Missing | Add checkbox like AgentNumbersLogin |

## Implementation

### 1. Create Privacy Policy Page

**File: `src/pages/Privacy.tsx`**

A styled legal page matching the APEX brand with sections for:
- Information We Collect
- How We Use Your Information
- Information Sharing
- Data Security
- Your Rights
- Contact Information

### 2. Create Terms of Service Page

**File: `src/pages/Terms.tsx`**

A styled legal page with sections for:
- Acceptance of Terms
- Agent Relationship (independent contractor status)
- Licensing Requirements
- Code of Conduct
- Intellectual Property
- Limitation of Liability
- Termination
- Changes to Terms
- Contact Information

### 3. Create Disclosures Page

**File: `src/pages/Disclosures.tsx`**

A styled legal page with sections for:
- Income Disclosure (results not guaranteed)
- Independent Contractor Status
- Licensing Requirements
- Carrier Relationships
- No Employment Guarantee
- Product Information
- Contact Information

### 4. Add Routes to App.tsx

Add three new routes before the catch-all `*` route:

```tsx
<Route path="/privacy" element={<Privacy />} />
<Route path="/terms" element={<Terms />} />
<Route path="/disclosures" element={<Disclosures />} />
```

### 5. Add "Remember Me" to Login Page

**File: `src/pages/Login.tsx`**

Add the same "Remember Me" checkbox that exists in `AgentNumbersLogin.tsx`:

- Add state: `const [rememberMe, setRememberMe] = useState(true);`
- Add checkbox UI between password field and submit button
- Import `Checkbox` component from `@/components/ui/checkbox`

## Page Design

All three legal pages will follow a consistent design pattern:

```text
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Home                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     📄  [Page Title]                                            │
│         Last updated: January 27, 2026                          │
│                                                                 │
│     ┌───────────────────────────────────────────────────────┐  │
│     │  Section 1: Title                                      │  │
│     │  Content paragraph with legal text...                  │  │
│     └───────────────────────────────────────────────────────┘  │
│                                                                 │
│     ┌───────────────────────────────────────────────────────┐  │
│     │  Section 2: Title                                      │  │
│     │  Content paragraph with legal text...                  │  │
│     └───────────────────────────────────────────────────────┘  │
│                                                                 │
│     ... more sections ...                                       │
│                                                                 │
│     Contact: info@kingofsales.net | (469) 767-6068             │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Footer]                                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/Privacy.tsx` | **Create** | Privacy Policy page |
| `src/pages/Terms.tsx` | **Create** | Terms of Service page |
| `src/pages/Disclosures.tsx` | **Create** | Disclosures page |
| `src/pages/Login.tsx` | **Modify** | Add "Remember Me" checkbox |
| `src/App.tsx` | **Modify** | Add routes for new pages |

## Technical Details

### Legal Page Template

Each legal page will:
- Use `GlassCard` component for content sections
- Include "Back to Home" navigation link
- Show last updated date dynamically
- Include Footer component for consistency
- Be fully responsive for mobile

### Remember Me Implementation

The Supabase client already handles session persistence via localStorage. The "Remember Me" checkbox serves as a visual indicator and can be extended later to control session duration if needed.

```tsx
// In Login.tsx - add between password and submit button:
<div className="flex items-center space-x-2">
  <Checkbox 
    id="remember-me" 
    checked={rememberMe}
    onCheckedChange={(checked) => setRememberMe(checked === true)}
  />
  <Label htmlFor="remember-me" className="text-sm text-muted-foreground cursor-pointer">
    Remember me
  </Label>
</div>
```

## Success Criteria

1. ✅ Footer links to `/privacy`, `/terms`, `/disclosures` work
2. ✅ All legal pages match APEX brand styling
3. ✅ Pages are mobile responsive
4. ✅ "Back to Home" navigation works
5. ✅ Login page has "Remember Me" checkbox like agent login
6. ✅ All routes registered in App.tsx

