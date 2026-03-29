# Monetisation Strategy — Safety Signage Audit (AS 1319)

## Pricing Model

**$149 AUD (inc. GST), one-off lifetime licence** with 3 free audits as the acquisition funnel.

## Pricing Rationale

### Value-Based Justification

| Metric | Manual | With App |
|--------|--------|----------|
| Cost per sign | $60–80 | ~$5 |
| Signs per day | 16–24 | 100–150+ |
| Time per sign | ~30 min | ~30 sec |

At $149, the app pays for itself in 2–3 signs. A single small audit of 50 signs saves $2,750–$3,750 vs manual methods. The ROI is immediate and obvious — making the purchase decision trivial for any safety professional.

### Why Not $99?

- The app is a **professional compliance tool** with AI-powered classification, GPS evidence, and audit-defensible reports. $99 undervalues that positioning and signals "hobby tool."
- Target buyers (safety officers, utilities, mining ops) expense tools routinely. $99 vs $149 makes zero difference to their purchase decision.

### Why Not $199?

- No brand recognition yet. The 3 free audits are the acquisition funnel — the price needs to feel like an easy "yes" after the user has experienced the value.
- Sole traders and small safety consultants are part of the addressable market. $199 creates friction for individuals who pay out of pocket.
- Price can always increase later once there is traction and testimonials.

## Gating Model

| Audit Count | State | Behaviour |
|-------------|-------|-----------|
| 0–2 | `free` | Full access, no account needed |
| 3+ (no licence) | `trial_expired` | Existing data accessible, new audit creation blocked by paywall modal |
| 3+ (licensed) | `licensed` | Unlimited access |

### Why 3 Free Audits?

- Enough to experience full value on a real job
- Not enough to avoid paying
- Sweet spot for conversion — the user has already invested time and seen the productivity uplift

### What Stays Accessible Without a Licence?

- All existing audits, captures, and reports
- CSV export and print for existing data
- Reference material (AS 1319 quick reference)
- Camera, GPS, and all capture features (within the 3-audit limit)

## Market Context

### Australian Addressable Market (from Board Deck)

- Water & Wastewater Utilities: 700+ treatment plants, 800+ SPSs (Unitywater alone)
- Mining Operations: 500+
- Manufacturing & Industrial Facilities: 110,000+
- Estimated 200 signs per facility
- **Total Addressable Market: 10M+ signs**

### Revenue Projections at $149

| Adoption | Customers | Revenue |
|----------|-----------|---------|
| 0.1% of facilities (110) | 110 | $16,390 |
| 0.5% of facilities (550) | 550 | $81,950 |
| 1% of facilities (1,100) | 1,100 | $163,900 |

### Future Upsell Path

The one-off licence is the **market entry wedge**. Once adoption is proven:

- **Enterprise SaaS subscriptions** — per-seat or per-site licensing for organisations
- **Site-based licensing** — volume pricing for large facility portfolios
- **Multi-year enterprise agreements** — locked-in contracts for utilities and mining companies
- **Per-sign audit pricing** ($5–10) for high-volume customers

## Technical Architecture

```
Browser (PWA)  ──>  Supabase (auth + licence table)
                         ↑
Stripe Checkout  ──>  Supabase Edge Function (webhook)
```

- **Payment processor**: Stripe (1.75% + 30c per transaction, native AUD, handles GST)
- **Backend**: Supabase free tier (email/password auth + single `licenses` table)
- **Licence validation**: Server-side via Supabase, cached locally for 7 days (offline-friendly)
- **No database migration for audit data** — all audit data remains in IndexedDB on device

## Competitor Landscape

| Competitor | Model | Price | Differentiation |
|-----------|-------|-------|-----------------|
| SafetyCulture/iAuditor | Monthly SaaS | $24–49/user/month | General-purpose audit. Not AS 1319 specific. |
| Safety Champion | Monthly SaaS | $5–15/user/month | Broad safety management. No signage focus. |
| **MySafeSigns** | **One-off $149** | **$149 lifetime** | **AS 1319 specialist. AI-powered. Offline-first. No recurring cost.** |

The one-off pricing is a competitive advantage — safety professionals prefer to "buy and own" tools rather than manage yet another subscription.
