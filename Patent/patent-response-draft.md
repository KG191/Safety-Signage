# Patent Application — Response to Lawyer's Request

**Prepared:** 30 March 2026
**Applicant:** SymbioTeK Pty Ltd (ACN 694 230 334)
**Invention:** MySafeSigns — AI-Powered Safety Signage Compliance Audit System

---

## 1. Description of the Invention

### What it is

- A mobile-first progressive web application (PWA) for auditing workplace safety signage compliance against Australian Standard AS 1319-1994 (Safety signs for the occupational environment)
- Combines AI vision models, machine learning, and computer vision to automate sign detection, classification, and compliance assessment
- Replaces manual field auditing workflows that currently take ~30 minutes per sign with a ~30-second automated process

### What it does

- **Two-phase camera capture**: captures a wide-angle context photo (site/location evidence) followed by a close-up of the sign (fed into AI detection pipeline)
- **Batch credit system**: users purchase AI detection credits in batches (100–1,000 signs), choosing between Sonnet (fast, cost-effective) and Opus (highest accuracy for faded/damaged signs). Credits are managed server-side with atomic deduction per capture. 3 free captures with Opus for new users.
- **Three-tier AI detection pipeline**:
  - **Tier 1 (Primary)**: Cloud-based Vision AI (Claude API) proxied through a server-side Edge Function — sends sign image, receives structured compliance assessment as JSON, including sign category, sign number, 20 compliance checks, confidence score, and reasoning. User's credit balance is atomically decremented per capture.
  - **Tier 2 (Secondary)**: Fine-tuned MobileNet v3 machine learning model running in-browser via TensorFlow.js — classifies sign category from image without internet
  - **Tier 3 (Fallback)**: Pure computer vision pipeline using colour analysis, shape detection, and sign classification — works fully offline with no external dependencies
- **Automated compliance assessment**: evaluates signs against 20 AS 1319 compliance checks (7 auto-assessed from image, 2 semi-auto, 11 requiring manual auditor judgment)
- **Adaptive confidence scoring**: signal-aware algorithm that weights colour and shape confidence dynamically, applies agreement bonuses when multiple detection methods concur
- **GPS and location capture**: records coordinates and 4-level hierarchical location description for each sign
- **Automated report generation**: produces gap analysis reports with compliance statistics, sign-by-sign findings with photo evidence, and failure pattern analysis mapped to specific AS 1319 clauses
- **Offline-first architecture**: all audit data stored locally on device in IndexedDB; full detection pipeline works without internet connectivity
- **Export capabilities**: HTML reports (print-ready) and CSV export for integration with GIS systems and spreadsheets

---

## 2. Special/Differentiating Features

### 2.1 Dual-Phase Camera Capture (Context + Sign Close-Up)

- Traditional audit tools capture a single photo per finding
- MySafeSigns explicitly separates the **context photo** (wide-angle site shot for audit evidence) from the **sign close-up** (optimised for AI analysis)
- Context photos provide defensible audit trail; sign photos are optimised for detection accuracy
- If AI detection fails, the context photo is still preserved as evidence

### 2.2 Hybrid Three-Tier Detection Pipeline with Adaptive Fallback

- No competitor offers a tiered AI → ML → CV fallback architecture
- System automatically degrades gracefully: Vision API (highest accuracy, requires internet) → fine-tuned ML model (good accuracy, in-browser) → pure computer vision (baseline accuracy, fully offline)
- Each tier produces a standardised detection result, enabling seamless fallback without user awareness
- 15-second timeout on Vision API automatically triggers next tier

### 2.3 Adaptive Confidence Weighting Algorithm

- Novel algorithm that dynamically weights colour and shape detection signals based on their relative strength:
  - When signals disagree significantly (>0.3 gap), the stronger signal gets 75% weight
  - When signals agree, equal weighting with a +0.1 agreement bonus
  - ML model confidence blended with adaptive weight (0.4 for fine-tuned, 0.2 for generic)
  - Fine-tuned model agreement bonus (+0.05) when ML and CV categories match
- Prevents false positives from low-quality images while maintaining sensitivity for clear signs
- No competitor uses signal-aware adaptive weighting

### 2.4 K-Means + Grid Hybrid Colour Detection

- Combines K-means clustering (global colour identification) with grid-based spatial analysis (coverage verification and bounding box)
- More robust than either method alone: K-means handles colour diversity; grid provides spatial context
- Safety colour ranges calibrated to AS 2700 standard references with real-world tolerance for fading, lighting variation, and camera colour shift
- Fallback from K-means to grid if clusters are too diffuse

### 2.5 Three-Method Shape Ensemble with Agreement Bonus

- Three independent shape detection methods vote on sign shape:
  1. **Fill-ratio analysis**: aspect ratio and fill percentage within bounding box
  2. **Contour-based classification**: Sobel edge detection → Moore contour tracing → Douglas-Peucker simplification → vertex counting and circularity metric
  3. **Radial symmetry circle test**: 36-ray cast from centroid, coefficient of variation of edge distances
- Agreement bonus (+0.15) when two or more methods agree
- Resolves ambiguities that defeat single-method approaches (e.g., thick triangle edges giving high circularity)

### 2.6 Colour Fidelity Assessment Against AS 2700 References

- Separate from "correct colour" detection — measures whether the sign's colour has faded from the standard
- Euclidean RGB distance from detected dominant colour to the AS 2700 reference values (R13 Signal Red, Y15 Sunflower, G21 Jade, B23 Bright Blue)
- Threshold of 100 RGB distance allows for camera and lighting variance while catching significant fading
- No competitor separates hue correctness from colour intensity/fading

### 2.7 Domain-Specific Compliance Framework (AS 1319-1994)

- 20 compliance checks directly mapped to specific AS 1319 clauses
- 7 checks auto-assessable from image analysis alone (colour, shape, legend colour, standard symbol, legibility, condition, colour fidelity)
- Auto-assessment uses image quality metrics: Laplacian variance (sharpness), average saturation (fading), WCAG contrast ratio (legibility)
- Overall assessment algorithm: pass rate across auto-assessable checks determines compliant / minor NC / major NC classification
- No generic audit tool (SafetyCulture, iAuditor) provides AS 1319-specific automated compliance checking

### 2.8 Offline-First Architecture for Remote Sites

- All audit data stored in browser IndexedDB — never requires cloud connectivity
- Photos stored as embedded JPEG data URLs directly in the database
- Full CV detection pipeline runs entirely in-browser using HTML5 Canvas (no external libraries)
- Fine-tuned ML model cached locally after first download
- Credit balance cached locally with short TTL for responsiveness; validated server-side on each AI call
- Critical for target market: mining sites, water treatment plants, remote infrastructure

### 2.9 Auditor Override Tracking

- When the AI auto-populates form fields, each field is visually marked with a confidence-based colour indicator
- If the auditor changes an AI-suggested value, the override is tracked in the detection metadata
- Report generation includes override statistics — identifies where AI and human judgement diverge
- Enables continuous improvement of detection algorithms and provides audit defensibility

### 2.10 Automated Gap Analysis

- Aggregates compliance check failures across all signs in an audit
- Identifies the most prevalent failure patterns (e.g., "colour faded" affects 12 of 50 signs)
- Maps each failure to specific AS 1319 clauses for remediation guidance
- Prioritises remediation work by failure frequency
- No competitor auto-generates AS 1319-specific gap analysis

### 2.11 Batch Credit System with Dual-Model Selection

- Users purchase AI detection credits in pre-defined batches, selecting between two AI models based on site conditions:
  - **Sonnet** — fast, cost-effective, recommended for well-maintained sites with clear signage
  - **Opus** — highest accuracy, recommended for older sites, mines, outdoor installations with faded or damaged signage
- Separate credit pools per model prevent cross-spending (Sonnet credits cannot be used for Opus calls)
- Credits are deducted atomically server-side via a vision proxy Edge Function, preventing overdraw under concurrent usage
- Immutable transaction ledger tracks every credit purchase and usage for auditability
- 3 free captures with Opus for new users — lets them experience the best accuracy before purchasing
- No competitor offers a pay-per-analysis model with user-selectable AI model tiers for safety signage

---

## 3. Competitor Publications and Differentiation

### 3.1 SafetyCulture / iAuditor

- **What they do**: General-purpose mobile inspection and audit platform. Template-based checklists for any industry. Photo capture with annotations.
- **Publications/presence**: iauditor.com (now SafetyCulture), publicly listed on ASX
- **How MySafeSigns differs**:
  - SafetyCulture is generic — users manually create checklists. MySafeSigns has AS 1319 compliance checks built in
  - No AI-powered sign detection or classification — SafetyCulture requires manual data entry for each finding
  - No computer vision, no automated compliance assessment, no colour/shape analysis
  - Subscription model ($24-49/user/month) vs MySafeSigns batch credit pricing ($49–$499 per batch)
  - SafetyCulture captures 15-20 signs/day vs MySafeSigns 100-150+/day

### 3.2 Safety Champion

- **What they do**: Workplace safety management software. Incident reporting, hazard management, audit scheduling.
- **Publications/presence**: safetychampion.com.au, Australian company
- **How MySafeSigns differs**:
  - Safety Champion is broad WHS management — not signage-specific
  - No AI detection, no image analysis, no AS 1319 compliance automation
  - Subscription model ($5-15/user/month)
  - Does not offer field-level sign-by-sign capture and classification

### 3.3 SignManager / Sign Management Software

- **What they do**: Sign asset management — tracking sign inventory, locations, replacement schedules
- **How MySafeSigns differs**:
  - SignManager tracks sign assets (what's installed where); MySafeSigns audits sign compliance (is it correct per AS 1319)
  - No AI detection, no photo-based compliance assessment
  - Desktop-oriented, not mobile-first field tool

### 3.4 Academic/Research Publications

- Computer vision for traffic sign detection (GTSDB, GTSRB datasets) — focused on road signs, not workplace safety signage. Different standards (Vienna Convention vs AS 1319), different sign categories, different compliance criteria.
- ISO 7010 pictogram recognition research — MySafeSigns' fine-tuned model is trained on ORP-SIG-2024 dataset (94K images, 299 ISO 7010 pictograms) but maps outputs to AS 1319 categories, which is a novel application not found in published research.

### 3.5 Key Competitive Differentiators Summary

| Capability | MySafeSigns | Competitors |
|-----------|-------------|-------------|
| AS 1319-specific compliance | Yes (20 checks, 7 auto-assessed) | No |
| AI-powered sign detection | Yes (3-tier pipeline) | No |
| Colour analysis against AS 2700 | Yes (K-means + grid + fidelity) | No |
| Shape detection ensemble | Yes (3-method + agreement bonus) | No |
| Adaptive confidence scoring | Yes (signal-aware weighting) | No |
| Offline-first with full CV | Yes (no internet needed) | Limited (draft mode only) |
| Two-phase camera capture | Yes (context + close-up) | No (single photo) |
| Automated gap analysis | Yes (AS 1319 clause-mapped) | No |
| Pay-per-batch pricing | Yes ($49–$499 per batch) | No (monthly subscription) |
| Dual AI model selection | Yes (Sonnet / Opus) | No |
| Throughput | 100-150 signs/day | 15-24 signs/day |

---

## 4. Figures and Drawings

The following figures are provided as SVG vector diagrams (in the `Patent/` folder):

1. **Fig 1: System Architecture** (`Fig1-System-Architecture.svg`) — Full system architecture showing user device (PWA), server-side vision proxy with credit-based gating, Supabase (auth + credits), Stripe (batch purchases), and Anthropic API. Three swim lanes: device, external services, server-side Edge Functions.

2. **Fig 2: Two-Phase Camera Capture** (`Fig2-Two-Phase-Camera.svg`) — Step-by-step flow: licence check → Phase 1 context photo (low quality, audit evidence) → Phase 2 sign close-up (high quality, AI analysis) → detection pipeline → form auto-population.

3. **Fig 3: Three-Tier Detection Pipeline** (`Fig3-Detection-Pipeline.svg`) — Detailed flowchart of the hybrid AI → ML → CV fallback architecture with timeout values, standardised output format, and confidence-based form population thresholds.

4. **Fig 4: Adaptive Confidence Algorithm** (`Fig4-Adaptive-Confidence.svg`) — Visual representation of the signal-aware weighting algorithm with three steps (adaptive weighting, agreement bonus, ML blending) and a worked example demonstrating how the algorithm prevents unnecessary manual review.

5. **Fig 5: Compliance Check Framework** (`Fig5-Compliance-Framework.svg`) — The 20 AS 1319 compliance checks categorised as auto-assessed (7), semi-auto (2), and manual (11), with detection methods listed for each auto-assessed check and the overall assessment formula.

6. **Fig 6: App Screenshots** (`Fig6-Screenshots-Guide.md`) — Guide for capturing 10 annotated screenshots covering the full audit workflow: cover screen, account sign-in, EULA, pricing tab, dashboard, new audit, camera phases, AI detection results, compliance checklist, and paywall.

7. **Fig 7: Data Model** (`Fig7-Data-Model.svg`) — Entity-relationship diagram across three storage layers: IndexedDB (on-device audit data), localStorage (preferences and cache), and Supabase (auth.users, credits, credit_transactions, and grandfathered licenses). Privacy by design: audit data never leaves the device.
