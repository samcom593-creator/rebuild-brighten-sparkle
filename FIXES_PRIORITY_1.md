# APEX Website — Priority 1 Fixes (CRITICAL)

**Status:** Ready to Execute  
**Total Effort:** 4.5 hours  
**Expected Outcome:** Build succeeds, no security vulnerabilities, 99 fewer ESLint errors  

---

## FIX 1: Create Missing LeadsLanding.tsx

**Status:** ⏳ PENDING  
**Effort:** 2 hours  
**Impact:** Unblocks build, enables 3 routes (/leads, /get-leads, /dialer)

### What to build:
```
src/pages/LeadsLanding.tsx
├── Hero section promoting lead generation
├── Benefits cards (3-4)
├── CTA button: "Get Started" → /get-licensed
├── FAQ section (5-6 questions)
├── Testimonials from agents with leads
└── Footer with contact info
```

### Technical specs:
- Use existing component library (Card, Button, etc.)
- Responsive design (mobile-first)
- Dark theme matching brand
- Animate hero on load
- SEO-optimized title/description

**Template outline ready. Implement or ask Claude to build this.**

---

## FIX 2: Remove & Rotate Exposed Secrets

**Status:** ⏳ PENDING  
**Effort:** 30 minutes  
**Impact:** Eliminates security vulnerability; prevents unauthorized Supabase access

### Steps:
1. **Check current .env contents:**
   ```bash
   cd ~/Desktop/APEX-OS && cat .env
   ```

2. **Rotate Supabase keys** (Supabase Dashboard):
   - Go to Project Settings → API
   - Generate new SUPABASE_PUBLISHABLE_KEY
   - Save new keys to `.env.local` (DO NOT COMMIT)

3. **Remove from git history:**
   ```bash
   git filter-branch --tree-filter 'rm -f .env' HEAD
   git push origin main --force
   ```

4. **Protect future commits:**
   ```bash
   echo ".env" >> .gitignore
   echo ".env.local" >> .gitignore
   git add .gitignore && git commit -m "Add .env to gitignore"
   git push origin main
   ```

5. **Update CI/CD:** Set environment variables in GitHub Secrets or Lovable Cloud

**This must happen FIRST before any other pushes.**

---

## FIX 3: Add Security Attributes to External Links

**Status:** ⏳ PENDING  
**Effort:** 30 minutes  
**Impact:** Prevents tab nabbing attacks; fixes 2 ESLint warnings

### Files to update (12+ instances):
```
src/components/admin/CourseContentViewer.tsx
src/components/growth/InstagramDirectory.tsx
src/components/dashboard/ManagerInviteLinks.tsx
src/pages/RecruiterDashboard.tsx
... (9+ more)
```

### Pattern:
```tsx
// BEFORE
<a href="https://external.com" target="_blank">Link</a>

// AFTER
<a href="https://external.com" target="_blank" rel="noopener noreferrer">Link</a>
```

### Automated search:
```bash
cd ~/Desktop/APEX-OS
grep -r 'target="_blank"' src/ --include="*.tsx" | grep -v 'rel=' | wc -l
```

**Codex can fix all instances in parallel across multiple files.**

---

## FIX 4: Sanitize dangerouslySetInnerHTML

**Status:** ⏳ PENDING  
**Effort:** 1 hour  
**Impact:** Eliminates XSS vulnerability; prevents code injection from email content

### File:
```
src/components/dashboard/AgedLeadEmailPreview.tsx
```

### Current vulnerable pattern:
```tsx
<div dangerouslySetInnerHTML={{ __html: emailContent }} />
```

### Fix (Option A - use DOMPurify):
```tsx
import DOMPurify from 'dompurify';

<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailContent) }} />
```

### Fix (Option B - use sanitize-html):
```tsx
import sanitizeHtml from 'sanitize-html';

const sanitized = sanitizeHtml(emailContent, {
  allowedTags: ['b', 'i', 'u', 'p', 'br', 'a', 'ul', 'ol', 'li'],
  allowedAttributes: { 'a': ['href', 'target'] }
});

<div dangerouslySetInnerHTML={{ __html: sanitized }} />
```

**Recommended: Option B (more control). Step 1: npm install sanitize-html**

---

## Summary Before/After

| Metric | Before | After |
|--------|--------|-------|
| Build Status | ❌ FAILS | ✅ SUCCEEDS |
| Security Issues | 2 CRITICAL | 0 CRITICAL |
| ESLint Errors | 1374 | 1374 (unchanged) |
| Vulnerable Deps | 14 | 14 (unchanged) |
| External Link Vulns | 12 | 0 |

**These 4 fixes unlock the ability to deploy. Then we fix types/deps.**

---

## Next Phase (Priority 2)

Once Priority 1 complete:
1. Update vulnerable dependencies (1 hour)
2. Enable TypeScript strict mode (4-6 hours)
3. Fix React Hook dependencies (2-3 hours)
4. Add sitemap & manifest (1.5 hours)

