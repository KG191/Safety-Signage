/**
 * Compliance Engine — Auto-assessment of image-assessable compliance checks
 * against AS 1319-1994 requirements.
 *
 * Can auto-assess 6 of 13 checks from image analysis alone.
 * The remaining 7 require auditor judgement (size, visibility, location, etc.).
 */

/** The 6 checks that can be auto-assessed from image analysis */
const AUTO_ASSESSABLE_CHECKS = [
    'correct-colour',
    'correct-shape',
    'correct-legend-colour',
    'standard-symbol',
    'legible',
    'condition'
];

/** Checks that require auditor judgement */
const MANUAL_CHECKS = [
    'adequate-size',
    'visible',
    'location',
    'illumination',
    'not-hazard',
    'still-relevant',
    'not-cluttered'
];

/**
 * Run auto-assessment on the 6 image-assessable compliance checks.
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

    // 1. Correct safety colour (Clause 2.2, Table 2.1)
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
    // If we have candidate sign numbers, the symbol is likely standard
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
    const sharpnessThreshold = 0.001; // Threshold for "sharp enough"
    const contrastThreshold = 3.0;     // WCAG AA minimum
    const isSharp = sharpness > sharpnessThreshold;
    const hasContrast = contrastRatio > contrastThreshold;
    checks['legible'] = isSharp && hasContrast;
    checkConfidence['legible'] = isSharp ? (hasContrast ? 0.7 : 0.5) : 0.4;

    // 6. Condition — based on colour saturation (faded signs have low saturation)
    const saturationThreshold = 0.15; // Below this = likely faded
    checks['condition'] = saturation > saturationThreshold;
    checkConfidence['condition'] = saturation > 0.25 ? 0.7 : (saturation > saturationThreshold ? 0.5 : 0.6);

    // Overall suggestion
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
