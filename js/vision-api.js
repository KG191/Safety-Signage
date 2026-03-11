/**
 * Vision API Module — Sends captured sign images to Claude's Vision API
 * for high-accuracy AS 1319-1994 sign detection and compliance assessment.
 *
 * Primary detection method (online). CV pipeline is the offline fallback.
 * API key is stored in localStorage and provided by the user.
 */

const VISION_API_URL = 'https://api.anthropic.com/v1/messages';
const VISION_API_VERSION = '2023-06-01';
const VISION_MODEL_OPTIONS = {
    fast:     'claude-haiku-4-5-20251001',
    balanced: 'claude-sonnet-4-6',
    best:     'claude-opus-4-6'
};
const VISION_STORAGE_KEY = 'signageAudit_apiKey';
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
    "standard-symbol": true/false,
    "adequate-size": true/false or null,
    "legible": true/false,
    "visible": true/false,
    "location": true/false or null,
    "condition": true/false,
    "illumination": true/false or null,
    "not-hazard": true/false or null,
    "still-relevant": true/false or null,
    "not-cluttered": true/false or null
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
 * Get the stored API key.
 * @returns {string|null}
 */
function getVisionApiKey() {
    return localStorage.getItem(VISION_STORAGE_KEY);
}

/**
 * Store the API key.
 * @param {string} key
 */
function setVisionApiKey(key) {
    if (key) {
        localStorage.setItem(VISION_STORAGE_KEY, key.trim());
    } else {
        localStorage.removeItem(VISION_STORAGE_KEY);
    }
}

/**
 * Get the preferred model tier.
 * @returns {string} 'fast'|'balanced'|'best'
 */
function getVisionModelPref() {
    return localStorage.getItem(VISION_MODEL_PREF_KEY) || 'balanced';
}

/**
 * Set the preferred model tier.
 * @param {string} pref
 */
function setVisionModelPref(pref) {
    localStorage.setItem(VISION_MODEL_PREF_KEY, pref);
}

/**
 * Check if the Vision API is configured and available.
 * @returns {boolean}
 */
function isVisionApiAvailable() {
    return !!getVisionApiKey();
}

/**
 * Analyse a captured sign image using Claude's Vision API.
 *
 * @param {string} dataUrl - JPEG data URL of the captured image
 * @returns {Promise<object>} Structured detection result or null on failure
 */
async function analyseWithVisionAPI(dataUrl) {
    const apiKey = getVisionApiKey();
    if (!apiKey) return null;

    const modelPref = getVisionModelPref();
    const model = VISION_MODEL_OPTIONS[modelPref] || VISION_MODEL_OPTIONS.balanced;

    // Strip data URL prefix to get raw base64
    const base64Data = dataUrl.split(',')[1];
    if (!base64Data) return null;

    const requestBody = {
        model: model,
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

    const response = await fetch(VISION_API_URL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': VISION_API_VERSION,
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(`[Vision API] Error ${response.status}: ${errBody}`);
        if (response.status === 401) {
            throw new Error('Invalid API key. Check your key in Settings.');
        }
        throw new Error(`Vision API error: ${response.status}`);
    }

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

// --- Settings Panel Logic ---

function initVisionSettings() {
    const apiKeyInput = document.getElementById('vision-api-key');
    const modelSelect = document.getElementById('vision-model-pref');
    const saveBtn = document.getElementById('btn-save-vision-settings');
    const statusEl = document.getElementById('vision-settings-status');

    if (!apiKeyInput) return;

    // Load current values
    const currentKey = getVisionApiKey();
    if (currentKey) {
        apiKeyInput.value = currentKey;
    }
    if (modelSelect) {
        modelSelect.value = getVisionModelPref();
    }

    // Update status indicator
    updateVisionStatus();

    // Save button
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            setVisionApiKey(apiKeyInput.value);
            if (modelSelect) setVisionModelPref(modelSelect.value);
            updateVisionStatus();
            if (statusEl) {
                statusEl.textContent = 'Settings saved.';
                statusEl.className = 'vision-status-msg success';
                setTimeout(() => { statusEl.textContent = ''; }, 2000);
            }
        });
    }
}

function updateVisionStatus() {
    const indicator = document.getElementById('vision-api-indicator');
    if (!indicator) return;
    if (isVisionApiAvailable()) {
        indicator.textContent = 'Active';
        indicator.className = 'vision-indicator active';
    } else {
        indicator.textContent = 'Not configured';
        indicator.className = 'vision-indicator inactive';
    }
}

// Initialise settings when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVisionSettings);
} else {
    initVisionSettings();
}
