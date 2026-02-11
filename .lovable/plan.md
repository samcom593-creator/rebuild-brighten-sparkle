
# Fix Link Preview Image (OG Image)

## The Problem

When you share any link to your site (iMessage, Facebook, LinkedIn, etc.), it shows the old "Log Your Numbers" image. This is because the Open Graph meta tags in `index.html` point to `apex-daily-numbers-og.png`.

## The Fix

**File**: `index.html`

Replace the OG image references (lines 40 and 49) to use the Apex Financial logo that's already hosted on your storage:

- `og:image` → Use the Apex logo (the same one used as the favicon)
- `twitter:image` → Same update

The image URL will be updated from:
```
https://apex-financial.org/apex-daily-numbers-og.png
```
to the Apex logo:
```
https://storage.googleapis.com/gpt-engineer-file-uploads/VdcG1SqfUFTigN8tdIEC0A3rtMr2/uploads/1769193440683-6882deee13d64_ApexLogo.png
```

**Note**: For the best social media previews, OG images should ideally be 1200x630px. The current logo may appear small in the preview card. If you have a branded banner image at that size, that would be even better. Otherwise, the logo is a solid upgrade over the old "Log Your Numbers" graphic.

## Files to Modify

| File | Change |
|------|--------|
| `index.html` | Update `og:image` and `twitter:image` meta tags to use Apex Financial logo |
