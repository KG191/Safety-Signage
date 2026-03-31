# BYOK Market Analysis — Will Users Accept "Bring Your Own Key"?

**Date:** 31 March 2026

## Assessment: BYOK will turn off a significant portion of the target market

### The reality of the buyers

Safety officers at water utilities, mines, and manufacturing plants are **domain experts, not tech people**. Asking them to:

1. Create an Anthropic account
2. Understand what an API key is
3. Navigate a developer console
4. Manage their own billing with a separate company

...is a lot of friction for someone who just wants to photograph signs. Many won't bother, and they'll use the app with local CV only — which means they never experience the full value proposition (the "30 seconds per sign" that sells the app).

### The Australian market specifically

Australia's safety compliance market is mature in **regulation**, but the buyers are generally not technical. They're tradies, safety managers, and compliance officers. "API key" and "Anthropic" mean nothing to them. They want a tool that works out of the box.

### What competitors do

SafetyCulture/iAuditor charges $24-49/month and everything just works. No API keys, no third-party accounts. That's the UX bar buyers expect.

### Recommendation: Hybrid tier model (future release)

| Tier | Price | AI | Target |
|------|-------|----|--------|
| **Standard** | $149 one-off | Local CV only (works now) | Budget-conscious, offline-heavy users |
| **Pro** | $249 one-off or $19.99/month | AI included (proxied, Haiku model) | Most users — it just works |
| **BYOK** | $149 + own key | User picks model (Haiku/Sonnet/Opus) | Technical users who want Opus |

### Pro tier economics

At Haiku costs ($0.01/sign), a Pro user auditing 1,000 signs/year costs $10 in API fees — easily absorbed into a $249 price or $19.99/month subscription.

| Usage | Annual API cost | $249 one-off margin | $19.99/month margin |
|-------|----------------|--------------------|--------------------|
| 500 signs/year | $5 | $244 (98%) | $234.88 (98%) |
| 1,000 signs/year | $10 | $239 (96%) | $229.88 (96%) |
| 5,000 signs/year | $50 | $199 (80%) | $189.88 (79%) |
| 10,000 signs/year | $100 | $149 (60%) | $139.88 (58%) |

Even heavy users (10,000 signs/year) remain profitable. The server-side proxy code already exists (built and reverted during development) and can be re-enabled for the Pro tier.

### Launch strategy

1. **Launch now** with $149 + BYOK — ship and start getting users
2. **Gauge real feedback** — how many users set up an API key vs skip it?
3. **If users complain** about the API key step (likely) → add Pro tier with included AI
4. **Technical users** who want Opus accuracy can stay on BYOK

### Implementation readiness

The server-side proxy infrastructure for the Pro tier was already built:
- `supabase/functions/vision-proxy/index.ts` — proxies Anthropic API calls with server-side key
- Licence gating in the proxy — checks user's licence status before proxying
- `ANTHROPIC_API_KEY` Supabase secret — already configured

Re-enabling the Pro tier is a ~1 hour code change: restore the proxy, add a tier flag to the licence, and route AI calls through the proxy for Pro users.
