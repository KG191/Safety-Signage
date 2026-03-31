# BYOK UX Improvements — Future Options

**Date:** 31 March 2026
**Status:** To consider for future release

## Context

No matter how good the UX is, asking non-technical users to create an account on a separate platform and copy an API key is inherently friction. But the experience can be made significantly less painful.

## Recommended Approach: Combine Options A + B + C

### Option A: Clipboard Auto-Detect (Best UX)

When the user opens Settings, the app silently checks the clipboard. If it finds a string starting with `sk-ant-`, it shows a banner:

> "API key detected. Tap to activate."

One tap. Done. The user just needs to copy the key from Anthropic's site — the app handles the rest. No pasting into a tiny field, no typing.

### Option B: Big "Paste Key" Button

Replace the small text input with a large, obvious button: **"Paste Your API Key"**. Tapping it reads the clipboard, validates the format, and shows instant feedback (green checkmark + masked key). Much easier than tapping into a field, long-pressing, tapping Paste.

### Option C: Direct Deep Link

Instead of linking to `console.anthropic.com` (the homepage), link directly to the API key creation page at `console.anthropic.com/settings/keys`. Fewer clicks = less confusion.

## User Flow After Implementation

1. User reads "Go to console.anthropic.com/settings/keys" (direct link)
2. Creates key, copies it
3. Comes back to app → banner appears: "API key detected. Tap to activate."
4. One tap → green checkmark → done
5. If clipboard doesn't work (some browsers restrict it), the fallback "Paste Your API Key" button is right there

## Option D: Visual Step-by-Step (Deferred)

Inline screenshots/illustrations showing exactly what the Anthropic console looks like at each step. Deferred because screenshots go stale when Anthropic updates their UI.

## Implementation Notes

- Clipboard API (`navigator.clipboard.readText()`) requires HTTPS and user gesture on some browsers
- Fallback: paste button triggers clipboard read on user tap (always works)
- Validate format: string starts with `sk-ant-` and length > 20
- Success state: masked key display (e.g. `sk-ant-...7x3F`) with green checkmark
- Estimated effort: ~2 hours
