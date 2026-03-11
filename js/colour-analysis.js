/**
 * Colour Analysis Module — RGB→HSV conversion, dominant colour extraction,
 * AS 2700 safety colour matching for AS 1319-1994 sign detection.
 */

/**
 * Convert RGB to HSV colour space.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {{h: number, s: number, v: number}} H in degrees (0-360), S and V in 0-1
 */
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }

    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
}

/** AS 2700 safety colour HSV ranges with generous tolerance for real-world lighting */
const SAFETY_COLOUR_RANGES = {
    red:    { hRanges: [[0, 15], [345, 360]], sMin: 0.4, vMin: 0.2 },
    yellow: { hRanges: [[35, 60]],            sMin: 0.4, vMin: 0.4 },
    green:  { hRanges: [[130, 180]],          sMin: 0.25, vMin: 0.15 },
    blue:   { hRanges: [[190, 230]],          sMin: 0.3, vMin: 0.15 }
};

/**
 * Classify a single HSV pixel into a safety colour or neutral.
 * @param {{h: number, s: number, v: number}} hsv
 * @returns {string} 'red'|'yellow'|'green'|'blue'|'black'|'white'|'other'
 */
function classifyPixelColour(hsv) {
    // Black: very low value
    if (hsv.v < 0.15) return 'black';
    // White: very low saturation, high value
    if (hsv.s < 0.15 && hsv.v > 0.7) return 'white';

    for (const [colour, range] of Object.entries(SAFETY_COLOUR_RANGES)) {
        if (hsv.s < range.sMin || hsv.v < range.vMin) continue;
        for (const [hMin, hMax] of range.hRanges) {
            if (hsv.h >= hMin && hsv.h <= hMax) return colour;
        }
    }
    return 'other';
}

/**
 * K-means clustering on image pixels to find dominant colour clusters.
 * Samples every 8th pixel for performance (~10K points from 640px image).
 *
 * @param {ImageData} imageData - Raw pixel data
 * @param {number} [k=5] - Number of clusters
 * @returns {Array<{r: number, g: number, b: number, count: number, safetyColour: string}>}
 */
function kMeansClusters(imageData, k = 5) {
    const { data } = imageData;
    const numPixels = data.length / 4;

    // Sample every 8th pixel
    const samples = [];
    for (let i = 0; i < numPixels; i += 8) {
        const idx = i * 4;
        samples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }

    // Initialize centroids by spreading evenly across sample indices
    const centroids = [];
    for (let i = 0; i < k; i++) {
        const sIdx = Math.floor((i / k) * samples.length);
        centroids.push([...samples[sIdx]]);
    }

    const assignments = new Uint8Array(samples.length);

    // Run K-means for max 10 iterations
    for (let iter = 0; iter < 10; iter++) {
        let changed = false;

        // Assign each sample to nearest centroid
        for (let i = 0; i < samples.length; i++) {
            const [r, g, b] = samples[i];
            let bestDist = Infinity;
            let bestK = 0;
            for (let j = 0; j < k; j++) {
                const dr = r - centroids[j][0];
                const dg = g - centroids[j][1];
                const db = b - centroids[j][2];
                const dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestK = j;
                }
            }
            if (assignments[i] !== bestK) {
                assignments[i] = bestK;
                changed = true;
            }
        }

        if (!changed) break;

        // Recompute centroids
        const sums = Array.from({ length: k }, () => [0, 0, 0, 0]); // r, g, b, count
        for (let i = 0; i < samples.length; i++) {
            const c = assignments[i];
            sums[c][0] += samples[i][0];
            sums[c][1] += samples[i][1];
            sums[c][2] += samples[i][2];
            sums[c][3]++;
        }
        for (let j = 0; j < k; j++) {
            if (sums[j][3] > 0) {
                centroids[j][0] = sums[j][0] / sums[j][3];
                centroids[j][1] = sums[j][1] / sums[j][3];
                centroids[j][2] = sums[j][2] / sums[j][3];
            }
        }
    }

    // Count final assignments and classify each centroid
    const counts = new Uint32Array(k);
    for (let i = 0; i < samples.length; i++) {
        counts[assignments[i]]++;
    }

    const clusters = [];
    for (let j = 0; j < k; j++) {
        const [r, g, b] = centroids[j].map(Math.round);
        const hsv = rgbToHsv(r, g, b);
        clusters.push({
            r, g, b,
            count: counts[j],
            safetyColour: classifyPixelColour(hsv)
        });
    }

    // Sort by count descending
    clusters.sort((a, b) => b.count - a.count);
    return clusters;
}

/**
 * Analyse an ImageData buffer to extract dominant safety colour and colour regions.
 * Uses a 4x4 pixel grid for spatial layout and K-means clustering for
 * robust dominant colour detection.
 *
 * @param {ImageData} imageData - Raw pixel data from canvas
 * @returns {object} Analysis result with dominant colour, percentages, confidence
 */
function analyseColours(imageData) {
    const { data, width, height } = imageData;
    const gridSize = 4;
    const gridW = Math.floor(width / gridSize);
    const gridH = Math.floor(height / gridSize);

    // Count colour classifications via grid sampling
    const colourCounts = { red: 0, yellow: 0, green: 0, blue: 0, black: 0, white: 0, other: 0 };
    // Grid map for connected region detection (used by shape detection)
    const grid = new Array(gridH);
    let totalCells = 0;

    for (let gy = 0; gy < gridH; gy++) {
        grid[gy] = new Array(gridW);
        for (let gx = 0; gx < gridW; gx++) {
            // Sample centre pixel of each grid cell
            const px = gx * gridSize + Math.floor(gridSize / 2);
            const py = gy * gridSize + Math.floor(gridSize / 2);
            const idx = (py * width + px) * 4;

            const hsv = rgbToHsv(data[idx], data[idx + 1], data[idx + 2]);
            const colour = classifyPixelColour(hsv);
            grid[gy][gx] = colour;
            colourCounts[colour]++;
            totalCells++;
        }
    }

    // Calculate percentages from grid
    const percentages = {};
    for (const [colour, count] of Object.entries(colourCounts)) {
        percentages[colour] = count / totalCells;
    }

    // --- K-means clustering for robust dominant colour ---
    const clusters = kMeansClusters(imageData);
    const totalSamples = clusters.reduce((sum, c) => sum + c.count, 0);

    // Find dominant safety colour from K-means clusters
    const safetyColours = ['red', 'yellow', 'green', 'blue'];
    const clusterBySafety = {};
    for (const c of safetyColours) {
        clusterBySafety[c] = 0;
    }
    for (const cluster of clusters) {
        if (safetyColours.includes(cluster.safetyColour)) {
            clusterBySafety[cluster.safetyColour] += cluster.count;
        }
    }

    let dominant = null;
    let dominantClusterCount = 0;
    let secondDominantCount = 0;
    for (const c of safetyColours) {
        if (clusterBySafety[c] > dominantClusterCount) {
            secondDominantCount = dominantClusterCount;
            dominantClusterCount = clusterBySafety[c];
            dominant = c;
        } else if (clusterBySafety[c] > secondDominantCount) {
            secondDominantCount = clusterBySafety[c];
        }
    }

    const dominantPct = totalSamples > 0 ? dominantClusterCount / totalSamples : 0;

    // Fall back to grid-based dominant if K-means found nothing
    if (!dominant || dominantPct < 0.03) {
        dominant = null;
        let gridDomPct = 0;
        for (const c of safetyColours) {
            if (percentages[c] > gridDomPct) {
                gridDomPct = percentages[c];
                dominant = c;
            }
        }
        // Use grid percentage as dominantPct fallback
        if (dominant && gridDomPct >= 0.03) {
            // Keep grid-based result
        } else {
            dominant = null;
        }
    }

    // Find bounding box of dominant colour regions (from grid, needed by shape detection)
    let bbox = null;
    const effectiveDominant = dominant;
    if (effectiveDominant) {
        let minX = gridW, minY = gridH, maxX = 0, maxY = 0;
        for (let gy = 0; gy < gridH; gy++) {
            for (let gx = 0; gx < gridW; gx++) {
                if (grid[gy][gx] === effectiveDominant) {
                    if (gx < minX) minX = gx;
                    if (gx > maxX) maxX = gx;
                    if (gy < minY) minY = gy;
                    if (gy > maxY) maxY = gy;
                }
            }
        }
        if (maxX >= minX && maxY >= minY) {
            bbox = {
                x: minX * gridSize,
                y: minY * gridSize,
                w: (maxX - minX + 1) * gridSize,
                h: (maxY - minY + 1) * gridSize
            };
        }
    }

    // Secondary colour (for legend colour detection)
    let secondary = null;
    let secondaryPct = 0;
    for (const c of [...safetyColours, 'black', 'white']) {
        if (c !== dominant && percentages[c] > secondaryPct) {
            secondaryPct = percentages[c];
            secondary = c;
        }
    }

    // Confidence: blend K-means cluster clarity with grid coverage
    let confidence = 0;
    if (dominant && totalSamples > 0) {
        const clusterPct = dominantClusterCount / totalSamples;
        const secondClusterPct = secondDominantCount / totalSamples;
        const gridDomPct = percentages[dominant] || 0;

        // Blends colour clarity (how much stronger dominant is) with coverage
        const clarity = (secondClusterPct + clusterPct) > 0
            ? clusterPct / (clusterPct + secondClusterPct)
            : 0;
        confidence = Math.min(1, clarity * 0.7 + gridDomPct * 0.3);
    }

    return {
        dominantColour: dominant,
        dominantPercentage: dominantPct > 0 ? dominantPct : (dominant ? percentages[dominant] : 0),
        secondaryColour: secondary,
        secondaryPercentage: secondaryPct,
        percentages,
        bbox,
        grid,
        gridSize,
        confidence
    };
}

/**
 * Calculate average colour saturation in the image (used for condition/fading check).
 * @param {ImageData} imageData
 * @returns {number} Average saturation (0-1)
 */
function averageSaturation(imageData) {
    const { data } = imageData;
    let totalS = 0;
    let count = 0;
    // Sample every 16th pixel for speed
    for (let i = 0; i < data.length; i += 64) {
        const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
        totalS += hsv.s;
        count++;
    }
    return count > 0 ? totalS / count : 0;
}

/**
 * Calculate contrast ratio between two regions (simplified).
 * Uses relative luminance per WCAG formula.
 * @param {ImageData} imageData
 * @param {string} colour1 - Safety colour name
 * @param {string} colour2 - Safety colour name
 * @param {Array} grid - Colour grid from analyseColours
 * @returns {number} Approximate contrast ratio
 */
function estimateContrastRatio(imageData, colour1, colour2, grid) {
    const { data, width } = imageData;
    const gridSize = 4;
    let lum1Total = 0, lum1Count = 0;
    let lum2Total = 0, lum2Count = 0;

    for (let gy = 0; gy < grid.length; gy++) {
        for (let gx = 0; gx < grid[gy].length; gx++) {
            const px = gx * gridSize + 2;
            const py = gy * gridSize + 2;
            const idx = (py * width + px) * 4;
            const lum = relativeLuminance(data[idx], data[idx + 1], data[idx + 2]);

            if (grid[gy][gx] === colour1) { lum1Total += lum; lum1Count++; }
            else if (grid[gy][gx] === colour2) { lum2Total += lum; lum2Count++; }
        }
    }

    if (lum1Count === 0 || lum2Count === 0) return 1;
    const l1 = lum1Total / lum1Count;
    const l2 = lum2Total / lum2Count;
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(r, g, b) {
    const rs = r / 255, gs = g / 255, bs = b / 255;
    const rl = rs <= 0.03928 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4);
    const gl = gs <= 0.03928 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4);
    const bl = bs <= 0.03928 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4);
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}
