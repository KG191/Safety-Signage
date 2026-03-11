/**
 * Sign Classifier — Decision tree combining colour + shape analysis
 * to determine AS 1319 category and candidate sign numbers.
 */

/** Maps category to expected colour and shape per AS 1319 Table 2.1 */
const CATEGORY_RULES = {
    prohibition:  { colours: ['red'],    shapes: ['circle'], legendColour: 'black',  needsSlash: true },
    mandatory:    { colours: ['blue'],   shapes: ['circle'], legendColour: 'white',  needsSlash: false },
    restriction:  { colours: ['red'],    shapes: ['circle'], legendColour: 'black',  needsSlash: false },
    warning:      { colours: ['yellow'], shapes: ['triangle'], legendColour: 'black', needsSlash: false },
    danger:       { colours: ['red'],    shapes: ['rectangle'], legendColour: 'black', needsSlash: false },
    emergency:    { colours: ['green'],  shapes: ['rectangle'], legendColour: 'white', needsSlash: false },
    fire:         { colours: ['red'],    shapes: ['rectangle'], legendColour: 'white', needsSlash: false }
};

/** Sign numbers by category for candidate lists */
const SIGN_NUMBERS_BY_CATEGORY = {
    prohibition: ['401', '402', '403', '404', '405'],
    mandatory:   ['421', '422', '423', '424', '425', '426', '427', '428', '429', '430'],
    warning:     ['441', '442', '443', '444', '445', '446', '447', '448', '449', '450', '451', '452', '453'],
    danger:      ['word-only'],
    emergency:   ['471', '472', '473'],
    fire:        [],
    restriction: []
};

/**
 * Classify a sign based on colour analysis and shape detection results.
 * Uses input-aware scoring — base score adapts to the quality of colour
 * and shape inputs rather than using hardcoded values.
 *
 * When an ML prediction is provided (from the fine-tuned AS 1319 model),
 * it is used to break ties and resolve ambiguous CV results (e.g.,
 * prohibition vs restriction for red circles without a detected slash).
 *
 * @param {object} colourResult - Output from analyseColours()
 * @param {object} shapeResult - Output from detectShape()
 * @param {number} [colourConf=0.5] - Colour analysis confidence (0-1)
 * @param {number} [shapeConf=0.5] - Shape detection confidence (0-1)
 * @param {object|null} [mlPrediction=null] - Output from classifyWithML() (fine-tuned model)
 * @returns {object} Classification result
 */
function classifySign(colourResult, shapeResult, colourConf = 0.5, shapeConf = 0.5, mlPrediction = null) {
    const { dominantColour, secondaryColour, percentages } = colourResult;
    const { shape, hasSlash } = shapeResult;

    if (!dominantColour) {
        return { category: null, confidence: 0, candidates: [], reasoning: 'No dominant safety colour detected' };
    }

    let bestCategory = null;
    let bestScore = 0;
    let reasoning = '';

    // Input-aware base score: adapts to signal quality
    // Both colour and shape confirmed: 0.5 + 0.25 + 0.25 = 1.0
    // Good colour (0.8) + weak shape (0.3): 0.5 + 0.2 + 0.075 = 0.775
    const bothMatchScore = 0.5 + (colourConf * 0.25) + (shapeConf * 0.25);
    // Colour-only fallback (shape didn't confirm)
    const colourOnlyScore = 0.25 + (colourConf * 0.25);

    // Extract ML category info for tie-breaking
    const mlCategory = (mlPrediction?.isFineTuned && mlPrediction.confidence > 0.5)
        ? mlPrediction.category : null;

    // Decision tree
    if (shape === 'circle' && hasSlash && (dominantColour === 'red' || secondaryColour === 'red')) {
        bestCategory = 'prohibition';
        bestScore = bothMatchScore;
        reasoning = 'Circle with diagonal bar + red colour = Prohibition';
    } else if (shape === 'circle' && dominantColour === 'blue') {
        bestCategory = 'mandatory';
        bestScore = bothMatchScore;
        reasoning = 'Blue circle = Mandatory';
    } else if (shape === 'circle' && dominantColour === 'red' && !hasSlash) {
        // Ambiguous: could be prohibition (slash missed) or restriction
        // Use ML prediction to resolve if available
        if (mlCategory === 'prohibition' || mlCategory === 'restriction') {
            bestCategory = mlCategory;
            bestScore = bothMatchScore * 0.85;
            reasoning = `Red circle — ML resolved as ${mlCategory} (${Math.round(mlPrediction.confidence * 100)}% confident)`;
        } else {
            bestCategory = 'restriction';
            bestScore = bothMatchScore * 0.7;
            reasoning = 'Red circle without diagonal bar = Restriction (or Prohibition if slash not detected)';
        }
    } else if (shape === 'triangle' && dominantColour === 'yellow') {
        bestCategory = 'warning';
        bestScore = bothMatchScore;
        reasoning = 'Yellow triangle = Warning/Hazard';
    } else if (shape === 'rectangle' && dominantColour === 'green') {
        bestCategory = 'emergency';
        bestScore = bothMatchScore * 0.95;
        reasoning = 'Green rectangle = Emergency Information';
    } else if (shape === 'rectangle' && dominantColour === 'red') {
        // Ambiguous: danger vs fire — use ML to resolve if available
        if (mlCategory === 'danger' || mlCategory === 'fire') {
            bestCategory = mlCategory;
            bestScore = bothMatchScore * 0.85;
            reasoning = `Red rectangle — ML resolved as ${mlCategory} (${Math.round(mlPrediction.confidence * 100)}% confident)`;
        } else if (percentages.black > 0.15) {
            bestCategory = 'danger';
            bestScore = bothMatchScore * 0.8;
            reasoning = 'Red rectangle with significant black area = DANGER';
        } else {
            bestCategory = 'fire';
            bestScore = bothMatchScore * 0.8;
            reasoning = 'Red rectangle = Fire';
        }
    } else {
        // Fallback: match colour alone — shape didn't contribute
        // If ML has a high-confidence prediction, prefer it over colour-only guess
        if (mlCategory) {
            bestCategory = mlCategory;
            bestScore = colourOnlyScore + 0.1;
            reasoning = `Shape inconclusive — ML suggests ${mlCategory} (${Math.round(mlPrediction.confidence * 100)}% confident)`;
        } else {
            const colourCategoryMap = {
                red: 'prohibition', blue: 'mandatory', yellow: 'warning', green: 'emergency'
            };
            if (colourCategoryMap[dominantColour]) {
                bestCategory = colourCategoryMap[dominantColour];
                bestScore = colourOnlyScore;
                reasoning = `Colour ${dominantColour} suggests ${bestCategory} (shape inconclusive)`;
            }
        }
    }

    // Boost or reduce score based on shape+colour agreement
    let colourMatch = false;
    let shapeMatch = false;
    if (bestCategory && shape !== 'unknown') {
        const rules = CATEGORY_RULES[bestCategory];
        if (rules) {
            colourMatch = rules.colours.includes(dominantColour) ||
                (bestCategory === 'prohibition' && (dominantColour === 'red' || secondaryColour === 'red'));
            shapeMatch = rules.shapes.includes(shape);
            if (colourMatch && shapeMatch) bestScore = Math.min(1, bestScore + 0.1);
            else if (!colourMatch || !shapeMatch) bestScore = Math.max(0.2, bestScore - 0.15);
        }
    }

    const candidates = bestCategory ? (SIGN_NUMBERS_BY_CATEGORY[bestCategory] || []) : [];

    return {
        category: bestCategory,
        confidence: Math.round(bestScore * 100) / 100,
        candidates,
        reasoning,
        colourMatch: bestCategory ? (colourMatch || CATEGORY_RULES[bestCategory]?.colours.includes(dominantColour)) : false,
        shapeMatch: bestCategory ? (shapeMatch || CATEGORY_RULES[bestCategory]?.shapes.includes(shape)) : false
    };
}

/**
 * Determine the expected legend colour for a detected category.
 * @param {string} category
 * @returns {string|null} Expected legend colour
 */
function getExpectedLegendColour(category) {
    return CATEGORY_RULES[category]?.legendColour || null;
}

/**
 * Check if the detected secondary colour matches the expected legend colour.
 * @param {string} category
 * @param {string} secondaryColour
 * @returns {boolean}
 */
function isLegendColourCorrect(category, secondaryColour) {
    const expected = getExpectedLegendColour(category);
    if (!expected || !secondaryColour) return false;
    return secondaryColour === expected;
}
