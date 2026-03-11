/**
 * Compliance Engine — Auto-assessment of image-assessable compliance checks
 * against AS 1319-1994 requirements.
 *
 * Can auto-assess 7 of 20 checks from image analysis alone.
 * The remaining 13 require auditor judgement or are semi-auto with manual override.
 */

/** The 7 checks that can be auto-assessed from image analysis */
const AUTO_ASSESSABLE_CHECKS = [
    'correct-colour',
    'correct-shape',
    'correct-legend-colour',
    'standard-symbol',
    'legible',
    'condition',
    'colour-fidelity'
];

/** Semi-auto checks — auto-assessed but flagged for manual confirmation */
const SEMI_AUTO_CHECKS = [
    'correct-enclosure',
    'correct-layout'
];

/** Checks that require auditor judgement */
const MANUAL_CHECKS = [
    'adequate-size',
    'visible',
    'location',
    'mounting-height',
    'not-moveable',
    'construction-safe',
    'illumination',
    'not-hazard',
    'still-relevant',
    'not-cluttered',
    'tag-compliant'
];

/** AS 2700 reference colours for colour fidelity check */
const AS2700_REFERENCES = {
    red:    { r: 204, g: 0, b: 0 },     // R13 Signal Red
    yellow: { r: 253, g: 184, b: 19 },   // Y15 Sunflower
    green:  { r: 0, g: 107, b: 63 },     // G21 Jade
    blue:   { r: 0, g: 75, b: 135 }      // B23 Bright Blue
};

/**
 * Run auto-assessment on the image-assessable compliance checks.
 *
 * @param {object} params
 * @param {object} params.colourResult - Output from analyseColours()
 * @param {object} params.shapeResult - Output from detectShape()
 * @param {object} params.classification - Output from classifySign()
 * @param {number} params.sharpness - Laplacian variance from shape-detection
 * @param {number} params.saturation - Average saturation from colour-analysis
 * @param {number} params.contrastRatio - Estimated contrast ratio
 * @returns {object} { checks: {checkId: bool}, checkConfidence: {checkId: number}, overall: string }
 */
function autoAssessCompliance(params) {
    const { colourResult, shapeResult, classification, sharpness, saturation, contrastRatio } = params;

    const checks = {};
    const checkConfidence = {};

    // 1. Correct safety colour hue (Clause 2.2, Table 2.1)
    if (classification.category && classification.colourMatch) {
        checks['correct-colour'] = true;
        checkConfidence['correct-colour'] = colourResult.confidence;
    } else if (classification.category) {
        checks['correct-colour'] = false;
        checkConfidence['correct-colour'] = colourResult.confidence;
    } else {
        checks['correct-colour'] = false;
        checkConfidence['correct-colour'] = 0.3;
    }

    // 2. Correct symbolic shape (Clause 2.2)
    if (classification.category && classification.shapeMatch) {
        checks['correct-shape'] = true;
        checkConfidence['correct-shape'] = shapeResult.confidence;
    } else if (classification.category) {
        checks['correct-shape'] = shapeResult.shape !== 'unknown' ? false : false;
        checkConfidence['correct-shape'] = shapeResult.confidence;
    } else {
        checks['correct-shape'] = false;
        checkConfidence['correct-shape'] = 0.3;
    }

    // 3. Correct legend colour (Table 3.1)
    const legendCorrect = isLegendColourCorrect(classification.category, colourResult.secondaryColour);
    checks['correct-legend-colour'] = legendCorrect;
    checkConfidence['correct-legend-colour'] = legendCorrect ? 0.7 : 0.5;

    // 4. Standard symbol from Appendix B (Clause 3.1/3.2)
    if (classification.candidates && classification.candidates.length > 0 &&
        !classification.candidates.includes('word-only')) {
        checks['standard-symbol'] = true;
        checkConfidence['standard-symbol'] = classification.confidence * 0.8;
    } else if (classification.category === 'danger') {
        // DANGER signs use words only — standard symbol check N/A, mark as pass
        checks['standard-symbol'] = true;
        checkConfidence['standard-symbol'] = 0.6;
    } else {
        checks['standard-symbol'] = false;
        checkConfidence['standard-symbol'] = 0.3;
    }

    // 5. Legible — based on sharpness (Laplacian variance) and contrast
    const sharpnessThreshold = 0.001;
    const contrastThreshold = 3.0;
    const isSharp = sharpness > sharpnessThreshold;
    const hasContrast = contrastRatio > contrastThreshold;
    checks['legible'] = isSharp && hasContrast;
    checkConfidence['legible'] = isSharp ? (hasContrast ? 0.7 : 0.5) : 0.4;

    // 6. Condition — based on colour saturation (faded signs have low saturation)
    const saturationThreshold = 0.15;
    checks['condition'] = saturation > saturationThreshold;
    checkConfidence['condition'] = saturation > 0.25 ? 0.7 : (saturation > saturationThreshold ? 0.5 : 0.6);

    // 7. Colour fidelity — compare dominant colour to AS 2700 reference (Clause 3.5)
    const fidelityResult = assessColourFidelity(colourResult, classification.category);
    checks['colour-fidelity'] = fidelityResult.pass;
    checkConfidence['colour-fidelity'] = fidelityResult.confidence;

    // Semi-auto: Enclosure (Clause 2.2) — check for white border on applicable categories
    const enclosureResult = assessEnclosure(colourResult, classification.category);
    if (enclosureResult !== null) {
        checks['correct-enclosure'] = enclosureResult;
        checkConfidence['correct-enclosure'] = 0.4; // Low confidence — needs manual confirmation
    }

    // Semi-auto: Layout (Clause 2.3) — basic detection of text alongside symbol
    // Left as manual for now — Vision API handles this much better

    // Overall suggestion based on auto-assessable checks
    const passedCount = AUTO_ASSESSABLE_CHECKS.filter(c => checks[c]).length;
    const totalAuto = AUTO_ASSESSABLE_CHECKS.length;
    const passRate = passedCount / totalAuto;

    let overall;
    if (passRate >= 1.0) {
        overall = 'compliant';
    } else if (passRate >= 0.8) {
        overall = 'minor-nc';
    } else {
        overall = 'major-nc';
    }

    return {
        checks,
        checkConfidence,
        overall,
        passedCount,
        totalAuto,
        passRate
    };
}

/**
 * Assess colour fidelity against AS 2700 reference values.
 * Compares the dominant detected colour's RGB to the standard reference.
 *
 * @param {object} colourResult - Output from analyseColours()
 * @param {string} category - Detected sign category
 * @returns {{ pass: boolean, confidence: number, distance: number }}
 */
function assessColourFidelity(colourResult, category) {
    if (!colourResult.dominantColour || !colourResult.dominantRGB) {
        return { pass: false, confidence: 0.3, distance: Infinity };
    }

    const ref = AS2700_REFERENCES[colourResult.dominantColour];
    if (!ref) {
        return { pass: false, confidence: 0.3, distance: Infinity };
    }

    const detected = colourResult.dominantRGB;
    // Simple Euclidean distance in RGB space
    const dist = Math.sqrt(
        Math.pow(detected.r - ref.r, 2) +
        Math.pow(detected.g - ref.g, 2) +
        Math.pow(detected.b - ref.b, 2)
    );

    // Threshold: allow generous tolerance for real-world photos (lighting, camera white balance)
    // Max RGB distance in 0-255 space is ~441. A threshold of 100 allows moderate fading.
    const threshold = 100;
    const pass = dist < threshold;
    const confidence = pass ? Math.min(0.8, 1 - (dist / threshold) * 0.5) : 0.5;

    return { pass, confidence, distance: dist };
}

/**
 * Assess whether a white enclosure/border is present on applicable sign categories.
 * Emergency (green) and fire (red rectangle) signs require white enclosures per Clause 2.2.
 *
 * @param {object} colourResult - Output from analyseColours()
 * @param {string} category - Detected sign category
 * @returns {boolean|null} true=enclosure present, false=missing, null=N/A for this category
 */
function assessEnclosure(colourResult, category) {
    // Only applicable to emergency, fire, and prohibition signs
    const needsEnclosure = ['emergency', 'fire', 'prohibition', 'restriction'];
    if (!needsEnclosure.includes(category)) {
        return null; // N/A
    }

    // Check if white is detected as secondary colour (rough proxy for white border)
    if (colourResult.secondaryColour === 'white') {
        return true;
    }

    // If we have a colour grid, check edges for white pixels
    if (colourResult.grid && colourResult.gridSize) {
        const { grid, gridSize } = colourResult;
        let edgeWhiteCount = 0;
        let edgeTotal = 0;

        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                // Only check edge cells
                if (i === 0 || i === gridSize - 1 || j === 0 || j === gridSize - 1) {
                    edgeTotal++;
                    const cell = grid[i * gridSize + j];
                    if (cell && cell.colour === 'white') {
                        edgeWhiteCount++;
                    }
                }
            }
        }

        if (edgeTotal > 0 && edgeWhiteCount / edgeTotal > 0.3) {
            return true;
        }
    }

    return false; // Could not confirm enclosure
}
