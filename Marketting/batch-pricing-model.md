# Batch Pricing Model — AI Sign Detection

**Date:** 31 March 2026
**Status:** Approved pricing structure

## Model

Users purchase batches of AI-powered sign detections. No BYOK required — AI is included and proxied through SymbioTeK's infrastructure. Users choose between two AI models based on their site conditions.

## Pricing

### Sonnet — Good for well-maintained sites

Best for sites with clear, well-lit, undamaged signage.

| Batch | API cost to SymbioTeK | Price (AUD inc. GST) | Margin |
|-------|----------------------|---------------------|--------|
| 100 signs | $5 | $49 | $44 (90%) |
| 250 signs | $12.50 | $99 | $86.50 (87%) |
| 500 signs | $25 | $149 | $124 (83%) |
| 1,000 signs | $50 | $249 | $199 (80%) |

### Opus — Recommended for faded/damaged signs

Best for older sites, mines, outdoor installations with weathering, faded colours, or damaged signage.

| Batch | API cost to SymbioTeK | Price (AUD inc. GST) | Margin |
|-------|----------------------|---------------------|--------|
| 100 signs | $25 | $79 | $54 (68%) |
| 250 signs | $62.50 | $169 | $106.50 (63%) |
| 500 signs | $125 | $299 | $174 (58%) |
| 1,000 signs | $250 | $499 | $249 (50%) |

## User Guidance

| Site condition | Recommended model |
|---------------|-------------------|
| New or well-maintained facility | Sonnet |
| Good lighting, clear signage | Sonnet |
| Older established sites | Opus |
| Mining operations | Opus |
| Outdoor / weathered signage | Opus |
| Faded colours, damaged signs | Opus |

## Comparison to Manual Costs

| Method | Cost per sign | 500 signs |
|--------|--------------|-----------|
| Manual audit | $60–80 | $30,000–40,000 |
| Sonnet batch | $0.30 | $149 |
| Opus batch | $0.60 | $299 |
| **Saving** | | **99%** |

## How It Works (User Perspective)

1. User downloads the free app
2. Creates an account (email/password)
3. Selects a batch size and model (Sonnet or Opus)
4. Pays via Stripe Checkout
5. AI detection credits are loaded to their account
6. Each photo taken deducts one credit
7. When credits run out, user purchases another batch

## Implementation Requirements

This model replaces the current $149 one-off + BYOK approach and requires:

1. **Re-enable server-side Vision API proxy** (Supabase Edge Function — code already exists)
2. **Credits system** — track remaining credits per user in Supabase
3. **Credits table** in Supabase (user_id, model, credits_remaining, credits_purchased, purchased_at)
4. **Multiple Stripe products** — one per batch/model combination (8 products total)
5. **Model selection in app** — user chooses Sonnet or Opus when purchasing
6. **Credit counter in app** — show remaining credits on Dashboard
7. **Remove BYOK settings** — API key managed server-side only
8. **Update EULA** — reflect new pricing model

## BYOK Fallback

For technical users who prefer their own API key and unlimited usage, retain a BYOK option at a reduced app price or free tier. This serves as a safety valve for power users.
