# Figure Formatting Rules

These rules apply to all patent figures (Fig 1–7) for consistency and professional presentation.

## 1. Orthogonal Arrows Only

All arrows use strictly horizontal and vertical segments with right-angle bends. No diagonal lines.

## 2. No Arrows Crossing Through Text Boxes

Arrows route around boxes via margins (left margin, right margin, or above/below rows). If a direct path would cross a box, reroute around it.

## 3. No Arrows Behind Filled Backgrounds

Arrows that cross filled regions (e.g. swim lane backgrounds) must be rendered last in the SVG so they draw on top. SVG renders elements in document order — later elements appear on top.

## 4. Arrows Touch Their Target Boxes

Arrowheads connect to box edges, not floating nearby. Start points exit from box surfaces (bottom, top, left, or right edges), not from corners.

## 5. Text Labels Sit Beside Arrows, Not On Them

Labels are placed to the left, right, above, or below their arrow line — never overlapping the line itself. Rotated text runs parallel to vertical segments, positioned clear of the line.

## 6. Section Titles Kept Clear

Swim lane titles (e.g. "SERVER-SIDE (Supabase Edge Functions)") must have no arrows or text crossing them. Route arrows above or below title text.

## 7. Colour Coding for Arrow Types

| Colour | Meaning |
|--------|---------|
| Blue (#2980B9) | Data flow within device |
| Purple (#8E44AD) | AI detection path (Pipeline → Anthropic) |
| Green (#1ABC9C) | Supabase auth/credits |
| Orange (#F39C12) | Stripe payments |
| Red (#CC0000) | Purchase flow (Credits → Checkout) |

## 8. No Disconnected Boxes

Every text box must have at least one arrow connecting it to the system. If a box appears disconnected, add the appropriate data flow arrow.

## 9. Consistent Box Styling

- White fill with coloured stroke for functional components
- Dashed stroke for on-device storage (IndexedDB)
- Rounded corners (rx=8 for boxes, rx=12 for swim lanes)
- Drop shadow filter on swim lanes and external service boxes

## 10. Label Placement

- Arrow labels use a smaller font size (7–8px) than box titles (10–12px)
- Labels positioned at the midpoint of their arrow segment
- Labels must not overlap any box, arrow, or section title
