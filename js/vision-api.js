/**
 * Vision API Module — Sends captured sign images to the vision proxy
 * for AI-powered AS 1319-1994 sign detection and compliance assessment.
 *
 * Primary detection method (online). CV pipeline is the offline fallback.
 * AI calls are proxied through Supabase Edge Functions (server-side API key).
 * Users purchase Sonnet or Opus credits in batches.
 */

const VISION_PROXY_URL = SUPABASE_URL + '/functions/v1/vision-proxy';
const VISION_MODEL_PREF_KEY = 'signageAudit_modelPref';

/** The structured prompt sent with every image analysis */
const VISION_SYSTEM_PROMPT = `You are an expert safety signage auditor assessing signs against Australian Standard AS 1319-1994 (Safety signs for the occupational environment).

Analyse the image and return a JSON object (no markdown, no explanation — only valid JSON) with these fields:

{
  "isSign": true/false,
  "category": "prohibition"|"mandatory"|"restriction"|"danger"|"warning"|"emergency"|"fire"|null,
  "signNumber": "401"-"405","421"-"430","441"-"453","471"-"473","word-only","non-standard", or null,
  "signText": "text visible on the sign" or null,
  "confidence": 0.0-1.0,
  "checks": {
    "correct-colour": true/false,
    "correct-shape": true/false,
    "correct-legend-colour": true/false,
    "correct-enclosure": true/false or null,
    "correct-layout": true/false or null,
    "standard-symbol": true/false,
    "adequate-size": true/false or null,
    "legible": true/false,
    "colour-fidelity": true/false,
    "visible": true/false,
    "location": true/false or null,
    "mounting-height": true/false or null,
    "not-moveable": true/false or null,
    "condition": true/false,
    "construction-safe": true/false or null,
    "illumination": true/false or null,
    "not-hazard": true/false or null,
    "still-relevant": true/false or null,
    "not-cluttered": true/false or null,
    "tag-compliant": true/false or null
  },
  "overall": "compliant"|"minor-nc"|"major-nc"|"missing"|"redundant",
  "reasoning": "brief explanation of assessment",
  "dominantColour": "red"|"yellow"|"green"|"blue"|null,
  "detectedShape": "circle"|"triangle"|"rectangle"|null,
  "conditionNotes": "any visible damage, fading, or condition issues"
}

Key AS 1319 rules to apply:
- Prohibition: red circle with diagonal bar, black legend, white interior (signs 401-405)
- Mandatory: blue filled circle, white legend (signs 421-430)
- Restriction: red annulus circle, black legend, white interior
- Warning/Hazard: yellow triangle with black border, black legend (signs 441-453)
- DANGER: red oval "DANGER" on black background, words only, no symbols (Clause 2.3.4)
- Emergency Info: green rectangle, white legend (signs 471-473)
- Fire: red rectangle, white legend
- Safety colours: Red R13 #CC0000, Yellow Y15 #FDB813, Green G21 #006B3F, Blue B23 #004B87
- Standard symbols must be from Appendix B or tested per AS 2342
- correct-enclosure: emergency/fire/prohibition signs require white enclosure or border (Clause 2.2)
- correct-layout: symbol-only, composite (symbol + text), or multi-message are acceptable; hybrid (words repeat symbol) is deprecated (Clause 2.3.3(d))
- colour-fidelity: assess whether safety colours appear vivid and close to AS 2700 references, or significantly faded
- mounting-height: ~1500mm above floor level is the target (Clause 4.2.2)
- not-moveable: sign should not be on a door, gate, or moveable object (Clause 4.2.4)
- construction-safe: sign appears structurally sound with secure fasteners (Clause 4.1.1)
- tag-compliant: if sign is a temporary tag, assess against Section 5; set null if not a tag
- Set null for checks you cannot assess from the image alone
- If the image does not contain a safety sign, set isSign=false and all other fields to null

Confidence calibration:
- 0.9-1.0: Sign clearly visible, well-lit, unambiguous category and type. Standard symbol recognisable.
- 0.7-0.89: Sign identifiable with minor issues — slight angle, partial shadow, minor fading, or specific sign number uncertain while category is clear.
- 0.5-0.69: Partially obscured, significantly faded, steep angle, or category ambiguous.
- 0.3-0.49: Very poor visibility, heavily damaged, or only fragments visible.
- 0.0-0.29: Cannot meaningfully identify as a safety sign.

When confident about CATEGORY but uncertain about sign NUMBER, use 0.7-0.8.
When confident about both category AND sign number, use 0.85+.
Do NOT be conservative — if the sign is clearly identifiable, return 0.9+.

Return ONLY the JSON object.`;

/**
 * Get the preferred model.
 * @returns {string} 'sonnet'|'opus'
 */
function getVisionModelPref() {
    return localStorage.getItem(VISION_MODEL_PREF_KEY) || 'opus';
}

/**
 * Set the preferred model.
 * @param {string} pref 'sonnet'|'opus'
 */
function setVisionModelPref(pref) {
    localStorage.setItem(VISION_MODEL_PREF_KEY, pref);
}

/**
 * Check if the Vision API is available (always true — proxy handles gating).
 * @returns {boolean}
 */
function isVisionApiAvailable() {
    return true;
}

/**
 * Analyse a captured sign image using Claude's Vision API.
 *
 * @param {string} dataUrl - JPEG data URL of the captured image
 * @returns {Promise<object>} Structured detection result or null on failure
 */
async function analyseWithVisionAPI(dataUrl) {
    const modelPref = getVisionModelPref();

    // Strip data URL prefix to get raw base64
    const base64Data = dataUrl.split(',')[1];
    if (!base64Data) return null;

    // Get user ID for credit deduction
    const user = await getLicenseUser();
    if (!user) throw new Error('NO_CREDITS'); // Must be signed in for AI

    const requestBody = {
        userId: user.id,
        modelPref: modelPref,
        max_tokens: 1024,
        messages: [{
            role: 'user',
            content: [
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/jpeg',
                        data: base64Data
                    }
                },
                {
                    type: 'text',
                    text: VISION_SYSTEM_PROMPT
                }
            ]
        }]
    };

    const response = await fetch(VISION_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(`[Vision API] Error ${response.status}: ${errBody}`);
        if (response.status === 403) {
            // Clear credit cache so UI updates
            clearCreditCache();
            throw new Error('NO_CREDITS');
        }
        throw new Error(`Vision API error: ${response.status}`);
    }

    // Clear credit cache after successful use (balance changed)
    clearCreditCache();

    const result = await response.json();
    const text = result.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Vision API');

    // Parse JSON from response (handle potential markdown wrapping)
    let parsed;
    try {
        const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
        parsed = JSON.parse(jsonStr);
    } catch (e) {
        console.error('[Vision API] Failed to parse response:', text);
        throw new Error('Could not parse Vision API response');
    }

    return parsed;
}

/**
 * Convert Vision API response to the detection result format
 * used by the detection pipeline.
 *
 * @param {object} visionResult - Parsed JSON from Vision API
 * @param {number} durationMs - Time taken for the API call
 * @returns {object} Detection result in pipeline format
 */
function visionResultToDetection(visionResult, durationMs) {
    if (!visionResult || !visionResult.isSign) {
        return {
            aiCategory: null,
            aiSignNumber: null,
            aiOverall: null,
            aiChecks: {},
            confidence: 0.1,
            colourConfidence: 0,
            shapeConfidence: 0,
            mlConfidence: 0,
            visionConfidence: visionResult?.confidence || 0,
            dominantColour: null,
            detectedShape: null,
            colourMatchScore: 0,
            auditorOverrides: { category: false, signNumber: false, overall: false, checks: [] },
            detectionDurationMs: durationMs,
            mlAvailable: false,
            visionApiUsed: true,
            reasoning: visionResult?.reasoning || 'No safety sign detected in image',
            conditionNotes: null
        };
    }

    // Convert null checks to false for form population
    const checks = {};
    if (visionResult.checks) {
        for (const [key, val] of Object.entries(visionResult.checks)) {
            checks[key] = val === true; // null → false
        }
    }

    const confidence = typeof visionResult.confidence === 'number' ? visionResult.confidence : 0.5;

    return {
        aiCategory: visionResult.category,
        aiSignNumber: visionResult.signNumber,
        aiOverall: visionResult.overall,
        aiChecks: checks,
        aiSignText: visionResult.signText,
        confidence: confidence,
        colourConfidence: confidence,
        shapeConfidence: confidence,
        mlConfidence: 0,
        visionConfidence: confidence,
        dominantColour: visionResult.dominantColour,
        detectedShape: visionResult.detectedShape,
        colourMatchScore: confidence,
        auditorOverrides: { category: false, signNumber: false, overall: false, checks: [] },
        detectionDurationMs: durationMs,
        mlAvailable: false,
        visionApiUsed: true,
        reasoning: visionResult.reasoning,
        conditionNotes: visionResult.conditionNotes
    };
}

// Vision AI is proxied server-side — no client-side settings needed.
// Model preference (sonnet/opus) is stored in localStorage.
