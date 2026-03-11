# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A mobile-first HTML/CSS/JS web app for field auditing safety signage compliance against **AS 1319-1994 (Reconfirmed 2018) — Safety signs for the occupational environment**. Auditors use a device camera to photograph signages at various sites, capture GPS coordinates, assess compliance against the standard, and generate gap-analysis reports.

## Running the App

No build system — plain HTML/CSS/JS. Serve locally with:
```
python3 -m http.server 8000
# or
npx serve .
```
Open on a mobile device (or localhost) to access camera and GPS features. HTTPS is required for camera/GPS on non-localhost origins.

## Architecture

```
index.html          — Single-page app, all views in one HTML file
css/styles.css      — All styles, mobile-first responsive, uses CSS custom properties
js/db.js            — IndexedDB wrapper (offline-first storage for audits + captures)
js/app.js           — Navigation, audit CRUD, capture form handling
js/camera.js        — Device camera access (rear-facing), photo capture as JPEG data URLs
js/reports.js       — Report generation, gap analysis, CSV export, print
manifest.json       — PWA manifest for add-to-homescreen
```

**Data model (IndexedDB — `SafetySignageAuditDB`):**
- `audits` store: `{id, siteName, client, auditor, date, notes, createdAt}`
- `captures` store: `{id, auditId, photo, lat, lng, locationDesc, category, signNumber, signText, checks, overall, notes, capturedAt}` — indexed on `auditId`, `category`, `overall`

**Navigation** is tab-based with 5 views: Dashboard, New Audit, Capture, Reports, Reference. View switching is handled by `switchView()` in `app.js`.

## AS 1319-1994 Standard — Key Domain Knowledge

The reference PDF is at `Signages AS1319-1994.pdf`. Key concepts the app encodes:

### Sign Classification (Clause 2.1)
| Category | Shape | Colour | Legend |
|---|---|---|---|
| Prohibition | Circle + diagonal bar | Red annulus/slash, white interior | Black |
| Mandatory | Filled circle | Blue | White |
| Restriction | Circle | Red annulus, white interior | Black |
| Warning | Equilateral triangle | Yellow, black enclosure | Black |
| DANGER | Red oval "DANGER" on black | White rectangle below/beside | Black text |
| Emergency Info | Rectangle | Green, white enclosure | White |
| Fire | Rectangle | Red, white enclosure | White |

### Safety Colours (Table 3.2, AS 2700)
- **Red:** R13 Signal Red (PMS 186C) — `#CC0000`
- **Yellow:** Y15 Sunflower (PMS 136C) — `#FDB813`
- **Green:** G21 Jade (PMS 349C) — `#006B3F`
- **Blue:** B23 Bright Blue (PMS 301C) — `#004B87`

### Standard Symbolic Signs (Appendix B)
- **Prohibition (Table B1):** 401-405 (smoking, fire/flame, pedestrian, drinking water, digging)
- **Mandatory (Table B2):** 421-430 (eye, respiratory full/half, head, hearing, hand, foot, body clothing, face, long hair)
- **Hazard (Table B3):** 441-453 (unspecified, fire, explosion, toxic, corrosion, ionizing radiation, electric shock, laser, opening door, forklifts, non-ionizing radiation, biological, guard dog)
- **Emergency Info (Table B4):** 471-473 (first aid, eye wash, shower)

### Sizing Rules (Clause 3.4.2)
- Good lighting: symbolic signs 15mm/m viewing distance; upper case 5mm/m; lower case 4mm/m
- Poor lighting: increase by 50%

### Compliance Checks Implemented
The capture form assesses against these AS 1319 requirements:
- **Colour & Shape** (Clause 2.2, Table 2.1): correct safety colour, shape, legend colour
- **Design** (Section 3): standard symbol, adequate size, legibility
- **Installation & Condition** (Section 4): visibility (4.2.1), siting (4.2.2), condition (4.3), illumination (4.2.5), not creating hazard (4.1)
- **Relevance**: still relevant (4.1), not cluttered (4.2.6)

### Important Standard Details
- DANGER signs use **words only** (no symbols). The DANGER symbol is a red oval with white "DANGER" text on a black background (Clause 2.3.4, Appendix C).
- Symbols must be from Appendix B or tested per AS 2342. Untested symbols are not permitted (Clause 3.2).
- "Warning" replaced "Caution" from earlier editions — the terms are interchangeable.
- Signs must be removed when no longer relevant; obsolete signs breed disrespect for all signage (Clause 4.1).
- Sign mounting height target: ~1500mm above floor level (Clause 4.2.2).
- Combination signs: "composite" (words augment symbol) vs "hybrid" (words repeat symbol meaning) — hybrid use is generally deprecated (Foreword, Clause 2.3.3(d)).

## Conventions

- No frameworks or build tools — vanilla JS with modern browser APIs
- IndexedDB for all persistent data (offline-first)
- Photos stored as JPEG data URLs (0.75 quality) directly in IndexedDB
- CSS custom properties define the colour palette, including AS 1319 safety colours
- All sign numbers, categories, and compliance checks reference specific AS 1319 clauses
