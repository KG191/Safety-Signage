# Figures & Drawings — Development Guide

## Recommended Tool

**Draw.io (diagrams.net)** — free, browser-based, exports to PNG/SVG/PDF. Use at [app.diagrams.net](https://app.diagrams.net). Supports flowcharts, architecture diagrams, and technical schematics. Patent lawyers typically accept PNG or PDF exports.

For polished versions, consider **Figma** (free tier) or **Lucidchart** (free tier, 3 documents).

---

## Figure 1: System Architecture Diagram

**Purpose:** Show the overall system structure — what components exist and how they connect.

**Layout:** Left-to-right flow, three horizontal swim lanes.

**Content:**

```
SWIM LANE 1: "User Device (PWA)"
┌──────────────────────────────────────────────────────────┐
│  Camera Module          →  Detection Pipeline            │
│  (context + close-up)      ├─ Vision API Client          │
│                            ├─ TensorFlow.js ML Model     │
│                            └─ CV Pipeline (Canvas API)   │
│                                                          │
│  Capture Form           →  IndexedDB                     │
│  (compliance checks)       (audits + captures + photos)  │
│                                                          │
│  Report Generator       →  HTML / CSV Export             │
│  (gap analysis)                                          │
│                                                          │
│  Licence Module         →  localStorage (cache)          │
└──────────────────────────────────────────────────────────┘
        │                          │
        │ HTTPS (user's API key)   │ HTTPS (auth + licence)
        ▼                          ▼

SWIM LANE 2: "External Services"
┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐
│  Anthropic API   │    │  Supabase       │    │  Stripe      │
│  (Claude Vision) │    │  (Auth + DB)    │    │  (Payments)  │
└─────────────────┘    └─────────────────┘    └──────────────┘
                              │                       │
                              │ Webhook               │
                              ▼                       │
SWIM LANE 3: "Server-Side"                            │
┌─────────────────────────────────────────────────────┘
│  Edge Functions:
│  ├─ create-checkout (→ Stripe Checkout URL)
│  └─ stripe-webhook  (→ Insert licence row)
│
│  Database:
│  └─ licenses table (user_id, status, stripe_id)
└──────────────────────────────────────────────────────
```

**Notes:**
- Use rounded rectangles for each component
- Colour-code: blue for user device, green for external services, grey for server-side
- Label each arrow with the data that flows (e.g., "JPEG image + prompt", "JSON detection result", "JWT token")
- Show that audit data (photos, GPS, compliance) stays on device — draw a dotted boundary around IndexedDB labelled "Data stays on device"
- Show the Anthropic API connection labelled "User's own API key (BYOK)"

---

## Figure 2: Two-Phase Camera Capture Flow

**Purpose:** Show the novel dual-phase capture process — context photo then sign close-up.

**Layout:** Vertical flowchart, 8 steps.

**Content:**

```
[Start Camera]
     │
     ▼
┌─────────────────────────┐
│ PHASE 1: Context Photo  │
│ "Wide-angle site shot"  │
│ 800px max, 50% JPEG     │
│ ┌───────────────────┐   │
│ │ 📷 Example:       │   │
│ │ Hallway with sign │   │
│ │ visible on wall   │   │
│ └───────────────────┘   │
└─────────┬───────────────┘
          │
    ┌─────┴─────┐
    │  Skip?    │──── Yes ──→ (no context photo stored)
    └─────┬─────┘                    │
          │ No                       │
          ▼                          │
  [Thumbnail shown]                  │
  [Camera stays live]                │
          │                          │
          ▼◄─────────────────────────┘
┌─────────────────────────┐
│ PHASE 2: Sign Close-up  │
│ "Focused sign capture"  │
│ Full resolution, 75%    │
│ ┌───────────────────┐   │
│ │ 📷 Example:       │   │
│ │ Close-up of sign  │   │
│ │ filling frame     │   │
│ └───────────────────┘   │
└─────────┬───────────────┘
          │
          ▼
  [Camera stops]
  [Image → Detection Pipeline]
          │
          ▼
  [Both photos saved with capture record]
```

**Notes:**
- Use two distinct coloured boxes for Phase 1 (light green) and Phase 2 (light blue) to emphasise the separation
- Include small placeholder image boxes showing example framing (wide vs close)
- Show the "Skip" branch for optional context photo
- Label the output arrow from Phase 2: "JPEG data URL → runDetectionPipeline()"
- Note at bottom: "Context photo provides audit evidence; sign photo feeds AI analysis"

---

## Figure 3: Detection Pipeline Flowchart

**Purpose:** Show the three-tier detection hierarchy with timeouts and fallbacks. This is the core novel architecture.

**Layout:** Vertical flowchart with three parallel branches converging.

**Content:**

```
[Sign Photo Captured (JPEG)]
          │
          ▼
  ┌───────────────────┐
  │ API Key available? │
  └───┬───────────┬───┘
      │ Yes       │ No
      ▼           │
┌─────────────────────────┐
│ TIER 1: Vision API      │
│ (Claude Haiku/Sonnet/   │
│  Opus)                  │
│                         │
│ Send: base64 image +    │
│   AS 1319 prompt        │
│ Receive: structured     │
│   JSON (category, sign  │
│   number, 20 checks,    │
│   confidence, reasoning)│
│                         │
│ Timeout: 15 seconds     │
└───┬──────────────┬──────┘
    │ Success      │ Fail/Timeout
    │              ▼
    │    ┌─────────────────────────┐
    │    │ TIER 2: ML Model       │
    │    │ (TensorFlow.js,        │
    │    │  MobileNet v3,         │
    │    │  fine-tuned AS 1319)   │
    │    │                        │
    │    │ In-browser inference   │
    │    │ ~500ms, offline OK     │
    │    │ Output: category only  │
    │    └───┬──────────────┬─────┘
    │        │ Loaded       │ Not available
    │        │              ▼
    │        │    ┌─────────────────────────┐
    │        │    │ TIER 3: CV Pipeline     │
    │        │    │ (Pure JavaScript)       │
    │        │    │                         │
    │        │    │ 1. Preprocess (640px)   │
    │        │    │ 2. White-balance        │
    │        │    │ 3. Histogram equalise   │
    │        │    │ 4. Colour analysis      │
    │        │    │    (K-means + grid)     │
    │        │    │ 5. Shape detection      │
    │        │    │    (3-method ensemble)  │
    │        │    │ 6. Classification       │
    │        │    │ 7. Compliance assess    │
    │        │    │                         │
    │        │    │ Timeout: 5 seconds      │
    │        │    │ Fully offline           │
    │        │    └───┬────────────────────┘
    │        │        │
    ▼        ▼        ▼
┌─────────────────────────────────┐
│ Standardised Detection Result   │
│                                 │
│ • category, signNumber          │
│ • 20 compliance checks          │
│ • confidence (0.0 - 1.0)        │
│ • reasoning text                │
│ • auditor override tracking     │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ Auto-Populate Capture Form      │
│                                 │
│ High (≥0.7): auto-fill + green │
│ Medium (0.4-0.69): fill + warn │
│ Low (<0.4): show only, manual  │
└─────────────────────────────────┘
```

**Notes:**
- Colour-code each tier: Tier 1 purple, Tier 2 orange, Tier 3 teal
- Use dashed arrows for fallback paths, solid arrows for success paths
- Label the timeout values prominently
- Show that all three tiers produce the same standardised output format
- This is the most patent-relevant diagram — make it clear and detailed

---

## Figure 4: Adaptive Confidence Weighting Algorithm

**Purpose:** Visualise the novel algorithm that combines multiple detection signals into a single confidence score.

**Layout:** Horizontal flow with formula boxes.

**Content:**

```
INPUTS:
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Colour       │  │ Shape        │  │ ML Model     │
│ Confidence   │  │ Confidence   │  │ Confidence   │
│ (0.0 - 1.0)  │  │ (0.0 - 1.0)  │  │ (0.0 - 1.0)  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 │
┌──────────────────────────────┐           │
│ STEP 1: Adaptive Weighting   │           │
│                              │           │
│ gap = |colourConf - shapeConf│           │
│                              │           │
│ IF gap > 0.3:                │           │
│   Trust stronger signal      │           │
│   Winner: 0.75 weight        │           │
│   Loser:  0.25 weight        │           │
│ ELSE:                        │           │
│   Equal: 0.50 / 0.50         │           │
│                              │           │
│ base = cConf×cW + sConf×sW   │           │
└──────────────┬───────────────┘           │
               │                           │
               ▼                           │
┌──────────────────────────────┐           │
│ STEP 2: Agreement Bonus      │           │
│                              │           │
│ IF colour AND shape both     │           │
│ match expected category:     │           │
│   base += 0.10               │           │
└──────────────┬───────────────┘           │
               │                           │
               ▼                           │
┌──────────────────────────────────────────┤
│ STEP 3: ML Blending                     │
│                                         │
│ IF ML available:                        │
│   mlWeight = 0.4 (fine-tuned)           │
│           or 0.2 (generic MobileNet)    │
│   base = base×(1-mlW) + mlConf×mlW     │
│                                         │
│ IF fine-tuned ML agrees with CV:        │
│   base += 0.05                          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│ OUTPUT: Composite Confidence │
│ (0.0 - 1.0)                 │
│                              │
│ ≥ 0.70 → HIGH (auto-fill)   │
│ 0.40-0.69 → MEDIUM (verify) │
│ < 0.40 → LOW (manual only)  │
└──────────────────────────────┘
```

**Notes:**
- Use a vertical pipeline style with formula boxes
- Highlight the "adaptive" aspect: the arrow from gap > 0.3 should split into two paths (trust stronger vs equal)
- Use green for agreement bonuses, red for disagreement penalties
- Include a worked example in a sidebar: e.g., "Colour: 0.85 (blue), Shape: 0.40 (ambiguous) → gap 0.45 → colour gets 0.75 weight → base = 0.74 → final: 0.74 (HIGH)"
- This algorithm is a key patentable feature

---

## Figure 5: Compliance Check Framework

**Purpose:** Show the 20 AS 1319 compliance checks categorised by assessment method.

**Layout:** Three-column table or three grouped boxes.

**Content:**

```
┌─────────────────────────────────────────────────────────────┐
│              AS 1319-1994 COMPLIANCE CHECKS (20)            │
├───────────────────┬──────────────────┬──────────────────────┤
│ AUTO-ASSESSED (7) │ SEMI-AUTO (2)    │ MANUAL (11)          │
│ (from image only) │ (detected, needs │ (auditor judgment)   │
│                   │  confirmation)   │                      │
├───────────────────┼──────────────────┼──────────────────────┤
│ ✓ Correct colour  │ ~ Correct        │ ○ Adequate size      │
│   (Clause 2.2)    │   enclosure      │   (Clause 3.4.2)     │
│                   │   (Clause 2.2)   │                      │
│ ✓ Correct shape   │                  │ ○ Visible/not        │
│   (Clause 2.2)    │ ~ Correct layout │   obscured (4.2.1)   │
│                   │   (Clause 2.3)   │                      │
│ ✓ Correct legend  │                  │ ○ Location/siting    │
│   colour (3.1)    │                  │   (Clause 4.2.2)     │
│                   │                  │                      │
│ ✓ Standard symbol │                  │ ○ Mounting height    │
│   (Clause 3.1/2)  │                  │   (Clause 4.2.2)     │
│                   │                  │                      │
│ ✓ Legible         │                  │ ○ Not moveable       │
│   (Clause 3.4)    │                  │   (Clause 4.2.4)     │
│                   │                  │                      │
│ ✓ Good condition  │                  │ ○ Construction safe  │
│   (Clause 4.3)    │                  │   (Clause 4.1.1)     │
│                   │                  │                      │
│ ✓ Colour fidelity │                  │ ○ Illumination       │
│   (Clause 3.5)    │                  │   (Clause 4.2.5)     │
│                   │                  │                      │
│                   │                  │ ○ Not a hazard       │
│ Detection method: │                  │   (Clause 4.1)       │
│ • Colour: K-means │                  │                      │
│   + grid hybrid   │                  │ ○ Still relevant     │
│ • Shape: 3-method │                  │   (Clause 4.1)       │
│   ensemble        │                  │                      │
│ • Legibility:     │                  │ ○ Not cluttered      │
│   Laplacian +     │                  │   (Clause 4.2.6)     │
│   contrast ratio  │                  │                      │
│ • Condition:      │                  │ ○ Tag compliant      │
│   saturation      │                  │   (Section 5)        │
│ • Fidelity:       │                  │                      │
│   AS 2700 RGB     │                  │                      │
│   distance        │                  │                      │
├───────────────────┴──────────────────┴──────────────────────┤
│ OVERALL ASSESSMENT:                                         │
│ Pass rate = auto-assessed passes / 7                        │
│ ≥ 1.0 → Compliant  │ 0.8-0.99 → Minor NC  │ <0.8 → Major │
└─────────────────────────────────────────────────────────────┘
```

**Notes:**
- Use three distinct colours: green (auto), amber (semi-auto), grey (manual)
- Each check should reference its AS 1319 clause number
- At the bottom, show the overall assessment formula
- Under the auto-assessed column, list the specific detection method used for each check
- This demonstrates the depth of domain-specific automation

---

## Figure 6: App Screenshots

**Purpose:** Show the user interface at each stage of the audit workflow.

**Layout:** A series of 6-8 annotated mobile phone screenshots arranged in workflow order.

**Content — capture these screens from the app:**

1. **Cover screen** — branded splash with Enter button
2. **Settings — Account & Licence** — sign-in form, licence status, EULA
3. **Settings — Vision AI** — API key entry, model selection (Opus recommended)
4. **Dashboard** — audit list, capture counter ("2 of 3 free captures used" or "Unlimited")
5. **New Audit form** — site name, client, auditor, date fields
6. **Camera — Phase 1** — context photo capture with phase label "Step 1 of 2"
7. **Camera — Phase 2 + Detection results** — sign close-up with AI detection panel showing confidence badge, detected category, reasoning, Accept/Edit/Reject buttons
8. **Compliance checklist** — 20 checks with AI-suggested items highlighted in green
9. **Report output** — gap analysis summary, compliance breakdown, sign-by-sign findings with thumbnails
10. **Paywall modal** — "$149 AUD" with Purchase Licence button

**Notes:**
- Use a real device or browser at mobile width (375px)
- Annotate each screenshot with callout arrows pointing to key features
- Screenshots are in `assets/Screenshots/` — update if needed with current UI
- Arrange in a 2x5 grid or single-column strip showing the workflow sequence
- Add a numbered caption below each: "Fig 6a: Dashboard with capture counter", etc.

---

## Figure 7: Data Model Diagram

**Purpose:** Show how data is structured and stored across IndexedDB, localStorage, and Supabase.

**Layout:** Entity-relationship diagram with three storage zones.

**Content:**

```
┌─────────────────────────────────────────────────────────┐
│ INDEXEDDB: SafetySignageAuditDB (On Device)             │
│                                                         │
│ ┌─────────────────┐     1:N     ┌─────────────────────┐│
│ │ AUDITS          │─────────────│ CAPTURES            ││
│ │                 │             │                     ││
│ │ id (PK)         │             │ id (PK)             ││
│ │ siteName        │             │ auditId (FK, IX)    ││
│ │ client          │             │ photo (JPEG dataURL)││
│ │ auditor         │             │ contextPhoto        ││
│ │ date (IX)       │             │ lat, lng            ││
│ │ notes           │             │ locationDesc        ││
│ │ createdAt       │             │ category (IX)       ││
│ │                 │             │ signNumber          ││
│ │                 │             │ signText            ││
│ │                 │             │ checks (object)     ││
│ │                 │             │ overall (IX)        ││
│ │                 │             │ notes               ││
│ │                 │             │ detection (object)  ││
│ │                 │             │   ├ confidence      ││
│ │                 │             │   ├ colourConf      ││
│ │                 │             │   ├ shapeConf       ││
│ │                 │             │   ├ mlConf          ││
│ │                 │             │   ├ visionConf      ││
│ │                 │             │   ├ auditorOverrides││
│ │                 │             │   └ reasoning       ││
│ │                 │             │ capturedAt          ││
│ └─────────────────┘             └─────────────────────┘│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ LOCALSTORAGE (On Device)                                │
│                                                         │
│ signageAudit_apiKey     → Anthropic API key (encrypted) │
│ signageAudit_modelPref  → "fast" | "balanced" | "best" │
│ license_cache           → { licensed: bool, until: ts } │
│ eula-accepted           → timestamp                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ SUPABASE (Cloud — Auth & Licensing Only)                │
│                                                         │
│ auth.users (managed by Supabase)                        │
│ │ id, email, encrypted_password, confirmed_at           │
│ │                                                       │
│ │  1:1                                                  │
│ ▼                                                       │
│ ┌─────────────────────┐                                 │
│ │ LICENSES            │                                 │
│ │                     │                                 │
│ │ id (PK)             │                                 │
│ │ user_id (FK, UQ)    │                                 │
│ │ stripe_checkout_id  │                                 │
│ │ stripe_customer_id  │                                 │
│ │ status              │                                 │
│ │ purchased_at        │                                 │
│ │ amount_aud          │                                 │
│ └─────────────────────┘                                 │
│                                                         │
│ NOTE: Audit data NEVER leaves the device.               │
│ Supabase stores auth + licence only.                    │
└─────────────────────────────────────────────────────────┘
```

**Notes:**
- Use standard ER diagram notation (PK, FK, IX for indexes)
- Draw a clear boundary between "On Device" (IndexedDB + localStorage) and "Cloud" (Supabase)
- Highlight the privacy design: "Audit data NEVER leaves the device" in bold/red
- Show the 1:N relationship between audits and captures
- Show the 1:1 relationship between auth.users and licenses
- The `detection` field in captures is a nested object — show its key subfields
