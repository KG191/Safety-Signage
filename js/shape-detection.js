/**
 * Shape Detection Module — Edge detection (Sobel) and shape classification
 * for AS 1319 sign shapes (circle, triangle, rectangle) via bounding-box geometry.
 * No OpenCV dependency — pure canvas-based.
 */

/**
 * Convert ImageData to grayscale array.
 * @param {ImageData} imageData
 * @returns {Float32Array} Grayscale values (0-1)
 */
function toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
        const idx = i * 4;
        gray[i] = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
    }
    return gray;
}

/**
 * Apply Sobel edge detection.
 * @param {Float32Array} gray - Grayscale image
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} Edge magnitude image (0-1)
 */
function sobelEdges(gray, width, height) {
    const edges = new Float32Array(width * height);
    const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sx = 0, sy = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const val = gray[(y + ky) * width + (x + kx)];
                    const ki = (ky + 1) * 3 + (kx + 1);
                    sx += val * gx[ki];
                    sy += val * gy[ki];
                }
            }
            edges[y * width + x] = Math.min(1, Math.sqrt(sx * sx + sy * sy));
        }
    }
    return edges;
}

/**
 * Calculate Laplacian variance (sharpness metric).
 * @param {Float32Array} gray - Grayscale image
 * @param {number} width
 * @param {number} height
 * @returns {number} Variance of Laplacian (higher = sharper)
 */
function laplacianVariance(gray, width, height) {
    let sum = 0, sumSq = 0, count = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const lap = gray[(y - 1) * width + x] + gray[(y + 1) * width + x]
                      + gray[y * width + (x - 1)] + gray[y * width + (x + 1)]
                      - 4 * gray[y * width + x];
            sum += lap;
            sumSq += lap * lap;
            count++;
        }
    }
    const mean = sum / count;
    return (sumSq / count) - (mean * mean);
}

/**
 * Apply a 3x3 Gaussian blur to a grayscale image to reduce noise before edge detection.
 * @param {Float32Array} gray - Grayscale image
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} Blurred image
 */
function gaussianBlur3x3(gray, width, height) {
    const blurred = new Float32Array(width * height);
    // 3x3 Gaussian kernel (sigma ~0.85): [1,2,1; 2,4,2; 1,2,1] / 16
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    const kSum = 16;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sum = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    sum += gray[(y + ky) * width + (x + kx)] * kernel[(ky + 1) * 3 + (kx + 1)];
                }
            }
            blurred[y * width + x] = sum / kSum;
        }
    }
    return blurred;
}

/**
 * Moore neighbourhood contour tracing on a binary edge map.
 * Returns an array of contours, each being an array of {x, y} points.
 *
 * @param {Uint8Array} binary - Binary edge map (0 or 1)
 * @param {number} width
 * @param {number} height
 * @param {number} minPerimeter - Minimum contour perimeter in pixels
 * @returns {Array<Array<{x: number, y: number}>>}
 */
function traceContours(binary, width, height, minPerimeter) {
    const visited = new Uint8Array(width * height);
    const contours = [];

    // Moore neighbourhood: 8 directions (clockwise from right)
    const dx = [1, 1, 0, -1, -1, -1, 0, 1];
    const dy = [0, 1, 1, 1, 0, -1, -1, -1];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            if (!binary[idx] || visited[idx]) continue;

            // Check if this is a boundary pixel (has at least one non-edge neighbour)
            let isBoundary = false;
            for (let d = 0; d < 8; d++) {
                if (!binary[(y + dy[d]) * width + (x + dx[d])]) {
                    isBoundary = true;
                    break;
                }
            }
            if (!isBoundary) continue;

            // Trace contour
            const contour = [];
            let cx = x, cy = y;
            let dir = 0; // Start looking right
            let maxSteps = width * height; // Safety limit

            do {
                contour.push({ x: cx, y: cy });
                visited[cy * width + cx] = 1;

                // Search for next edge pixel in Moore neighbourhood
                let found = false;
                const startDir = (dir + 5) % 8; // Backtrack direction + 1
                for (let i = 0; i < 8; i++) {
                    const d = (startDir + i) % 8;
                    const nx = cx + dx[d];
                    const ny = cy + dy[d];
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height && binary[ny * width + nx]) {
                        cx = nx;
                        cy = ny;
                        dir = d;
                        found = true;
                        break;
                    }
                }
                if (!found) break;
                maxSteps--;
            } while ((cx !== x || cy !== y) && maxSteps > 0);

            if (contour.length >= minPerimeter) {
                contours.push(contour);
            }
        }
    }

    return contours;
}

/**
 * Douglas-Peucker polyline simplification.
 * @param {Array<{x: number, y: number}>} points
 * @param {number} epsilon - Tolerance distance
 * @returns {Array<{x: number, y: number}>}
 */
function douglasPeucker(points, epsilon) {
    if (points.length <= 2) return points;

    // Find point with maximum distance from line between first and last
    const first = points[0];
    const last = points[points.length - 1];
    let maxDist = 0;
    let maxIdx = 0;

    const lineLen = Math.hypot(last.x - first.x, last.y - first.y);

    for (let i = 1; i < points.length - 1; i++) {
        let dist;
        if (lineLen === 0) {
            dist = Math.hypot(points[i].x - first.x, points[i].y - first.y);
        } else {
            dist = Math.abs(
                (last.y - first.y) * points[i].x -
                (last.x - first.x) * points[i].y +
                last.x * first.y - last.y * first.x
            ) / lineLen;
        }
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }

    if (maxDist > epsilon) {
        const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
        const right = douglasPeucker(points.slice(maxIdx), epsilon);
        return left.slice(0, -1).concat(right);
    }
    return [first, last];
}

/**
 * Compute contour area using the shoelace formula.
 * @param {Array<{x: number, y: number}>} contour
 * @returns {number}
 */
function contourArea(contour) {
    let area = 0;
    for (let i = 0; i < contour.length; i++) {
        const j = (i + 1) % contour.length;
        area += contour[i].x * contour[j].y;
        area -= contour[j].x * contour[i].y;
    }
    return Math.abs(area) / 2;
}

/**
 * Contour-based shape detection: traces edges, simplifies, and classifies.
 *
 * @param {Float32Array} gray - Grayscale image
 * @param {number} width
 * @param {number} height
 * @param {object} bbox - Bounding box to focus on
 * @returns {{shape: string, confidence: number}}
 */
function contourShapeDetect(gray, width, height, bbox) {
    if (!bbox || bbox.w < 10 || bbox.h < 10) {
        return { shape: 'unknown', confidence: 0 };
    }

    // Apply Gaussian blur then Sobel on the bbox region
    const blurred = gaussianBlur3x3(gray, width, height);
    const edges = sobelEdges(blurred, width, height);

    // Threshold edges at 0.3 to get binary edge map
    const binary = new Uint8Array(width * height);
    const x0 = Math.max(0, bbox.x);
    const y0 = Math.max(0, bbox.y);
    const x1 = Math.min(width, bbox.x + bbox.w);
    const y1 = Math.min(height, bbox.y + bbox.h);

    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            binary[y * width + x] = edges[y * width + x] > 0.3 ? 1 : 0;
        }
    }

    // Trace contours with minimum perimeter of 50px
    const contours = traceContours(binary, width, height, 50);

    if (contours.length === 0) {
        return { shape: 'unknown', confidence: 0 };
    }

    // Find largest contour with area > 500px
    let bestContour = null;
    let bestArea = 0;
    for (const contour of contours) {
        const area = contourArea(contour);
        if (area > 500 && area > bestArea) {
            bestArea = area;
            bestContour = contour;
        }
    }

    if (!bestContour) {
        return { shape: 'unknown', confidence: 0 };
    }

    // Compute circularity = 4*pi*area / perimeter^2
    const perimeter = bestContour.length;
    const circularity = (4 * Math.PI * bestArea) / (perimeter * perimeter);

    // Douglas-Peucker simplification to count vertices
    const epsilon = perimeter * 0.02;
    const simplified = douglasPeucker(bestContour, epsilon);
    const vertexCount = simplified.length;

    // Classify based on circularity and vertex count
    let shape = 'unknown';
    let confidence = 0;

    if (circularity > 0.7 || vertexCount > 6) {
        shape = 'circle';
        confidence = Math.min(1, circularity * 1.1);
    } else if (vertexCount === 3 || vertexCount === 4 && circularity < 0.65) {
        // 3 vertices = triangle; 4 with low circularity could be triangle with one merged vertex
        if (vertexCount === 3) {
            shape = 'triangle';
            confidence = 0.85;
        } else {
            shape = 'triangle';
            confidence = 0.6;
        }
    } else if (vertexCount === 4 || vertexCount === 5) {
        shape = 'rectangle';
        confidence = vertexCount === 4 ? 0.85 : 0.65;
    }

    return { shape, confidence };
}

/**
 * Radial symmetry circle test: cast rays from colour region centroid
 * and measure std dev of edge distances. Low std dev = circular.
 *
 * @param {Float32Array} edges - Edge magnitude image from Sobel
 * @param {number} width
 * @param {number} height
 * @param {object} bbox - Bounding box of the colour region
 * @returns {{isCircle: boolean, confidence: number}}
 */
function radialCircleTest(edges, width, height, bbox) {
    if (!bbox || bbox.w < 10 || bbox.h < 10) {
        return { isCircle: false, confidence: 0 };
    }

    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const maxRadius = Math.max(bbox.w, bbox.h) / 2 + 10;
    const numRays = 36; // Every 10 degrees
    const edgeDistances = [];

    for (let i = 0; i < numRays; i++) {
        const angle = (i / numRays) * 2 * Math.PI;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        // Walk along ray and find first strong edge pixel
        for (let r = 5; r < maxRadius; r++) {
            const px = Math.round(cx + dx * r);
            const py = Math.round(cy + dy * r);
            if (px < 0 || px >= width || py < 0 || py >= height) break;

            if (edges[py * width + px] > 0.25) {
                edgeDistances.push(r);
                break;
            }
        }
    }

    if (edgeDistances.length < 12) {
        // Not enough edge hits — can't determine
        return { isCircle: false, confidence: 0 };
    }

    // Compute mean and std dev of edge distances
    const mean = edgeDistances.reduce((a, b) => a + b, 0) / edgeDistances.length;
    const variance = edgeDistances.reduce((sum, d) => sum + (d - mean) ** 2, 0) / edgeDistances.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 1; // Coefficient of variation

    // Low CV (<0.15) = high circle confidence
    const isCircle = cv < 0.15;
    const confidence = isCircle ? Math.min(1, (0.15 - cv) / 0.15 * 0.8 + 0.2) : Math.max(0, 0.3 - cv);

    return { isCircle, confidence };
}

/**
 * Detect the shape of the sign within the given bounding box region.
 * Combines three methods: fill-ratio, contour analysis, and radial symmetry.
 *
 * @param {ImageData} imageData - Full image data
 * @param {object} bbox - Bounding box {x, y, w, h} of the colour region
 * @param {string} dominantColour - The dominant safety colour detected
 * @param {Array} grid - Colour grid from analyseColours
 * @param {number} gridSize - Grid cell size
 * @returns {object} {shape, confidence, hasSlash}
 */
function detectShape(imageData, bbox, dominantColour, grid, gridSize) {
    if (!bbox || bbox.w < 10 || bbox.h < 10) {
        return { shape: 'unknown', confidence: 0, hasSlash: false };
    }

    const { width, height } = imageData;

    // Calculate aspect ratio and fill ratio within the bounding box
    const aspectRatio = bbox.w / bbox.h;

    // Count how many grid cells within the bounding box match the dominant colour
    const gxStart = Math.floor(bbox.x / gridSize);
    const gyStart = Math.floor(bbox.y / gridSize);
    const gxEnd = Math.min(Math.floor((bbox.x + bbox.w) / gridSize), grid[0].length - 1);
    const gyEnd = Math.min(Math.floor((bbox.y + bbox.h) / gridSize), grid.length - 1);

    let filledCells = 0;
    let totalCells = 0;
    let redSlashCells = 0;

    for (let gy = gyStart; gy <= gyEnd; gy++) {
        for (let gx = gxStart; gx <= gxEnd; gx++) {
            totalCells++;
            if (grid[gy][gx] === dominantColour) filledCells++;
            if (grid[gy][gx] === 'red' && dominantColour !== 'red') redSlashCells++;
        }
    }

    const fillRatio = totalCells > 0 ? filledCells / totalCells : 0;

    // Check for diagonal red stripe (prohibition sign)
    let hasSlash = false;
    if (dominantColour !== 'red' && redSlashCells > 0) {
        const redRatio = redSlashCells / totalCells;
        hasSlash = redRatio > 0.05 && redRatio < 0.25;
    }
    // Also check for red annulus with non-red dominant (prohibition/restriction)
    if (dominantColour === 'white') {
        let edgeRedCells = 0, edgeTotalCells = 0;
        for (let gy = gyStart; gy <= gyEnd; gy++) {
            for (let gx = gxStart; gx <= gxEnd; gx++) {
                const isEdge = (gy === gyStart || gy === gyEnd || gx === gxStart || gx === gxEnd
                    || gy === gyStart + 1 || gy === gyEnd - 1 || gx === gxStart + 1 || gx === gxEnd - 1);
                if (isEdge) {
                    edgeTotalCells++;
                    if (grid[gy][gx] === 'red') edgeRedCells++;
                }
            }
        }
        if (edgeTotalCells > 0 && edgeRedCells / edgeTotalCells > 0.3) {
            hasSlash = redSlashCells / totalCells > 0.05;
        }
    }

    // --- Method 1: Fill-ratio shape classification (existing) ---
    let fillShape = 'unknown';
    let fillConf = 0;

    if (aspectRatio >= 0.85 && aspectRatio <= 1.15) {
        if (fillRatio >= 0.55 && fillRatio <= 0.95) {
            fillShape = 'circle';
            fillConf = 1 - Math.abs(fillRatio - 0.785) * 2;
        } else if (fillRatio > 0.95) {
            fillShape = 'circle';
            fillConf = 0.5;
        }
    }

    if (aspectRatio >= 0.8 && aspectRatio <= 1.5 && fillRatio >= 0.3 && fillRatio <= 0.65) {
        const triangleScore = 1 - Math.abs(fillRatio - 0.5) * 3;
        if (triangleScore > fillConf) {
            fillShape = 'triangle';
            fillConf = triangleScore;
        }
    }

    if ((aspectRatio > 1.3 || aspectRatio < 0.75) && fillRatio > 0.7) {
        const rectScore = Math.min(1, fillRatio * 1.1);
        if (rectScore > fillConf) {
            fillShape = 'rectangle';
            fillConf = rectScore;
        }
    }

    if (fillShape === 'unknown' && fillRatio > 0.8 && aspectRatio >= 0.75 && aspectRatio <= 1.3) {
        fillShape = 'rectangle';
        fillConf = 0.4;
    }

    fillConf = Math.max(0, Math.min(1, fillConf));

    // --- Method 2: Contour-based shape detection ---
    const gray = toGrayscale(imageData);
    const contourResult = contourShapeDetect(gray, width, height, bbox);

    // --- Method 3: Radial symmetry circle test ---
    const edges = sobelEdges(gray, width, height);
    const radialResult = radialCircleTest(edges, width, height, bbox);

    // --- Combine results ---
    // Take the best confidence from all methods
    let shape = fillShape;
    let confidence = fillConf;

    if (contourResult.confidence > confidence) {
        shape = contourResult.shape;
        confidence = contourResult.confidence;
    }

    // Radial test only contributes to circle detection
    if (radialResult.isCircle && radialResult.confidence > confidence) {
        shape = 'circle';
        confidence = radialResult.confidence;
    }

    // Agreement bonus: if two or more methods agree, boost confidence
    const methods = [
        { shape: fillShape, conf: fillConf },
        { shape: contourResult.shape, conf: contourResult.confidence },
    ];
    if (radialResult.isCircle) {
        methods.push({ shape: 'circle', conf: radialResult.confidence });
    }

    const agreeing = methods.filter(m => m.shape === shape && m.conf > 0.2);
    if (agreeing.length >= 2) {
        confidence = Math.min(1, confidence + 0.15);
    }

    confidence = Math.max(0, Math.min(1, confidence));

    return { shape, confidence, hasSlash, fillRatio, aspectRatio };
}
