/**
 * Detection Pipeline — Orchestrator that runs the full sign detection pipeline
 * on a captured image, manages progress UI, and populates the capture form.
 *
 * Pipeline strategy:
 *   PRIMARY: Vision API (Claude) — high accuracy, requires internet + API key
 *   FALLBACK: Local CV pipeline — works offline, lower accuracy
 *
 * Vision API steps: send image → receive structured JSON → populate form
 * CV fallback steps: preprocess → colour → shape → classify → compliance → populate
 */

const PIPELINE_TIMEOUT_MS = 15000; // Allow more time for Vision API
const CV_TIMEOUT_MS = 5000;        // Shorter timeout for CV-only fallback

/** Store the latest detection result for inclusion in save data */
let lastDetectionResult = null;

/**
 * Run the full detection pipeline on a captured image data URL.
 * Called from camera.js takePhoto() after photo capture.
 *
 * @param {string} dataUrl - JPEG data URL of the captured image
 */
async function runDetectionPipeline(dataUrl) {
    const startTime = performance.now();
    lastDetectionResult = null;

    // Show detection UI
    showDetectionStatus('Analysing image...', 0);

    // Strategy: try Vision API first, fall back to CV pipeline
    if (typeof isVisionApiAvailable === 'function' && isVisionApiAvailable()) {
        try {
            showDetectionStatus('Sending to Vision AI...', 20);

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Vision API timeout')), PIPELINE_TIMEOUT_MS)
            );

            const visionPromise = runVisionPipeline(dataUrl, startTime);
            await Promise.race([visionPromise, timeoutPromise]);
            return; // Vision API succeeded
        } catch (err) {
            console.warn('[Detection] Vision API failed, falling back to CV:', err.message);
            showDetectionStatus('Vision AI unavailable — running local analysis...', 10);
        }
    }

    // Fallback: local CV pipeline
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('CV detection timeout')), CV_TIMEOUT_MS)
        );

        const detectionPromise = runCVPipelineSteps(dataUrl, startTime);
        await Promise.race([detectionPromise, timeoutPromise]);
    } catch (err) {
        console.warn('[Detection] CV pipeline failed or timed out:', err.message);
        showDetectionStatus('Auto-detection unavailable — classify manually', -1);
        hideDetectionResults();
    }
}

/**
 * Run Vision API pipeline — sends image to Claude for analysis.
 */
async function runVisionPipeline(dataUrl, startTime) {
    showDetectionStatus('Vision AI analysing sign...', 40);

    const visionResult = await analyseWithVisionAPI(dataUrl);
    const durationMs = Math.round(performance.now() - startTime);

    showDetectionStatus('Processing results...', 80);

    lastDetectionResult = visionResultToDetection(visionResult, durationMs);

    // Auto-populate sign text if detected
    if (lastDetectionResult.aiSignText) {
        const textInput = document.getElementById('capture-sign-text');
        if (textInput && !textInput.value) {
            textInput.value = lastDetectionResult.aiSignText;
            applyAiStyling(textInput, getConfidenceLevel(lastDetectionResult.confidence));
        }
    }

    showDetectionStatus('Complete', 100);
    populateFormFromDetection(lastDetectionResult, { checks: lastDetectionResult.aiChecks });
}

/**
 * Execute local CV pipeline steps sequentially (offline fallback).
 */
async function runCVPipelineSteps(dataUrl, startTime) {
    // Step 1: Preprocess — load into offscreen canvas at reduced size
    showDetectionStatus('Preprocessing image...', 10);
    const { canvas: offCanvas, ctx, imageData: rawImageData } = await preprocessImage(dataUrl);

    // Step 1b: Enhance image — white-balance and histogram equalization
    showDetectionStatus('Enhancing image...', 15);
    const imageData = enhanceImageData(rawImageData, ctx, offCanvas);

    // Step 2: Colour analysis
    showDetectionStatus('Analysing colours...', 30);
    const colourResult = analyseColours(imageData);

    // Step 3: Shape detection
    showDetectionStatus('Detecting shape...', 50);
    const gray = toGrayscale(imageData);
    const shapeResult = detectShape(
        imageData, colourResult.bbox, colourResult.dominantColour,
        colourResult.grid, colourResult.gridSize
    );

    // Calculate sharpness and saturation
    const sharpness = laplacianVariance(gray, offCanvas.width, offCanvas.height);
    const saturation = averageSaturation(imageData);
    const contrastRatio = colourResult.dominantColour && colourResult.secondaryColour
        ? estimateContrastRatio(imageData, colourResult.dominantColour, colourResult.secondaryColour, colourResult.grid)
        : 1;

    // Step 4: ML classification (run before sign classifier so we can pass prediction)
    let mlResult = null;
    if (mlAvailable && mlModel) {
        showDetectionStatus('Running AI classification...', 65);
        const imgEl = document.getElementById('captured-image');
        mlResult = await classifyWithML(imgEl);
    }

    // Step 5: Sign classification (with optional ML prediction for tie-breaking)
    showDetectionStatus('Classifying sign...', 75);
    const classification = classifySign(colourResult, shapeResult, colourResult.confidence, shapeResult.confidence, mlResult);

    // Step 6: Compliance auto-assessment
    showDetectionStatus('Assessing compliance...', 90);
    const compliance = autoAssessCompliance({
        colourResult, shapeResult, classification,
        sharpness, saturation, contrastRatio
    });

    // Calculate composite confidence with adaptive weighting
    const colourConf = colourResult.confidence;
    const shapeConf = shapeResult.confidence;
    const mlConf = mlResult ? mlResult.confidence : 0;

    const compositeConfidence = computeAdaptiveConfidence(
        colourConf, shapeConf, mlConf, classification, mlResult
    );

    const durationMs = Math.round(performance.now() - startTime);

    // Resolve final category: prefer ML when fine-tuned and high-confidence
    const mlCategory = mlResult?.isFineTuned && mlResult.confidence > 0.6
        ? mlResult.category : null;
    const finalCategory = mlCategory || classification.category;

    // Build detection result
    lastDetectionResult = {
        aiCategory: finalCategory,
        aiSignNumber: mlResult?.signNumber || (classification.candidates.length === 1 ? classification.candidates[0] : null),
        aiOverall: compliance.overall,
        aiChecks: compliance.checks,
        confidence: Math.round(compositeConfidence * 100) / 100,
        colourConfidence: Math.round(colourConf * 100) / 100,
        shapeConfidence: Math.round(shapeConf * 100) / 100,
        mlConfidence: mlResult ? Math.round(mlConf * 100) / 100 : null,
        mlCategory: mlCategory,
        cvCategory: classification.category,
        dominantColour: colourResult.dominantColour,
        detectedShape: shapeResult.shape,
        colourMatchScore: colourResult.dominantPercentage,
        auditorOverrides: { category: false, signNumber: false, overall: false, checks: [] },
        detectionDurationMs: durationMs,
        mlAvailable,
        mlIsFineTuned: mlResult?.isFineTuned || false
    };

    // Step 7: Populate form based on confidence
    showDetectionStatus('Complete', 100);
    populateFormFromDetection(lastDetectionResult, compliance);
}

/**
 * Enhance image data with white-balance correction and histogram equalization.
 * Improves colour/shape detection under poor industrial lighting.
 *
 * @param {ImageData} imageData - Raw pixel data
 * @param {CanvasRenderingContext2D} ctx - Canvas context to write back to
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @returns {ImageData} Enhanced image data
 */
function enhanceImageData(imageData, ctx, canvas) {
    const data = imageData.data;
    const numPixels = data.length / 4;

    // --- White-balance correction ---
    // Collect brightness of each pixel, find top 5% brightest
    const brightnesses = new Float32Array(numPixels);
    for (let i = 0; i < numPixels; i++) {
        const idx = i * 4;
        brightnesses[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }

    // Find threshold for top 5%
    const sorted = Float32Array.from(brightnesses).sort();
    const threshIdx = Math.floor(numPixels * 0.95);
    const brightThreshold = sorted[threshIdx];

    if (brightThreshold > 50) { // Only correct if there are bright pixels
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let i = 0; i < numPixels; i++) {
            if (brightnesses[i] >= brightThreshold) {
                const idx = i * 4;
                rSum += data[idx];
                gSum += data[idx + 1];
                bSum += data[idx + 2];
                count++;
            }
        }

        if (count > 0) {
            const rAvg = rSum / count;
            const gAvg = gSum / count;
            const bAvg = bSum / count;
            const maxAvg = Math.max(rAvg, gAvg, bAvg);

            // Scale factors to map brightest average to white
            const rScale = maxAvg > 0 ? maxAvg / rAvg : 1;
            const gScale = maxAvg > 0 ? maxAvg / gAvg : 1;
            const bScale = maxAvg > 0 ? maxAvg / bAvg : 1;

            // Only apply if correction is moderate (avoid extreme shifts)
            if (rScale < 2 && gScale < 2 && bScale < 2) {
                for (let i = 0; i < numPixels; i++) {
                    const idx = i * 4;
                    data[idx]     = Math.min(255, Math.round(data[idx] * rScale));
                    data[idx + 1] = Math.min(255, Math.round(data[idx + 1] * gScale));
                    data[idx + 2] = Math.min(255, Math.round(data[idx + 2] * bScale));
                }
            }
        }
    }

    // --- Histogram equalization on V channel (HSV) ---
    // Build histogram of V values
    const histogram = new Uint32Array(256);
    for (let i = 0; i < numPixels; i++) {
        const idx = i * 4;
        const v = Math.max(data[idx], data[idx + 1], data[idx + 2]);
        histogram[v]++;
    }

    // Compute CDF
    const cdf = new Uint32Array(256);
    cdf[0] = histogram[0];
    for (let i = 1; i < 256; i++) {
        cdf[i] = cdf[i - 1] + histogram[i];
    }

    // Find minimum non-zero CDF value
    let cdfMin = 0;
    for (let i = 0; i < 256; i++) {
        if (cdf[i] > 0) { cdfMin = cdf[i]; break; }
    }

    // Build lookup table
    const lut = new Uint8Array(256);
    const denom = numPixels - cdfMin;
    if (denom > 0) {
        for (let i = 0; i < 256; i++) {
            lut[i] = Math.round(((cdf[i] - cdfMin) / denom) * 255);
        }
    }

    // Apply V-channel equalization while preserving hue and saturation
    for (let i = 0; i < numPixels; i++) {
        const idx = i * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const vOld = Math.max(r, g, b);
        if (vOld === 0) continue;

        const vNew = lut[vOld];
        const scale = vNew / vOld;
        data[idx]     = Math.min(255, Math.round(r * scale));
        data[idx + 1] = Math.min(255, Math.round(g * scale));
        data[idx + 2] = Math.min(255, Math.round(b * scale));
    }

    // Write enhanced data back to canvas and return fresh ImageData
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Compute adaptive composite confidence — trusts the stronger signal
 * when colour and shape disagree significantly.
 *
 * ML weight is higher (0.4) when the fine-tuned AS 1319 model is loaded,
 * lower (0.2) for legacy MobileNet-ImageNet.
 */
function computeAdaptiveConfidence(colourConf, shapeConf, mlConf, classification, mlResult) {
    const gap = Math.abs(colourConf - shapeConf);
    let cW, sW;
    if (gap > 0.3) {
        // Large disagreement: trust the stronger signal
        cW = colourConf > shapeConf ? 0.75 : 0.25;
        sW = 1 - cW;
    } else {
        cW = 0.5;
        sW = 0.5;
    }
    let base = colourConf * cW + shapeConf * sW;

    // Agreement bonus: colour and shape both match expected category
    if (classification.colourMatch && classification.shapeMatch) {
        base = Math.min(1, base + 0.1);
    }

    // Blend in ML confidence — fine-tuned model gets higher weight
    if (mlConf > 0) {
        const isFineTuned = mlResult && mlResult.isFineTuned;
        const mlWeight = isFineTuned ? 0.4 : 0.2;
        base = base * (1 - mlWeight) + mlConf * mlWeight;

        // Agreement bonus: ML category matches CV category
        if (isFineTuned && mlResult.category && mlResult.category === classification.category) {
            base = Math.min(1, base + 0.05);
        }
    }

    return Math.round(base * 100) / 100;
}

/**
 * Load image data URL into offscreen canvas at max 640px width.
 */
function preprocessImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const maxW = 640;
            const scale = img.width > maxW ? maxW / img.width : 1;
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            const imageData = ctx.getImageData(0, 0, w, h);
            resolve({ canvas, ctx, imageData });
        };
        img.onerror = () => reject(new Error('Failed to load image for detection'));
        img.src = dataUrl;
    });
}

/**
 * Populate the capture form fields from detection results.
 */
function populateFormFromDetection(result, compliance) {
    const confidenceLevel = getConfidenceLevel(result.confidence);

    if (confidenceLevel === 'low') {
        showDetectionResults(result, 'low');
        return; // Don't auto-populate for low confidence
    }

    // Auto-populate category
    if (result.aiCategory) {
        const categorySelect = document.getElementById('capture-sign-category');
        categorySelect.value = result.aiCategory;
        applyAiStyling(categorySelect, confidenceLevel);
    }

    // Auto-populate sign number
    if (result.aiSignNumber) {
        const signSelect = document.getElementById('capture-sign-number');
        signSelect.value = result.aiSignNumber;
        applyAiStyling(signSelect, confidenceLevel);
    }

    // Auto-populate compliance checks
    for (const [checkId, passed] of Object.entries(result.aiChecks)) {
        const cb = document.getElementById(`check-${checkId}`);
        if (cb) {
            cb.checked = passed;
            applyAiStyling(cb.closest('.check-item'), confidenceLevel);
        }
    }

    // Auto-populate overall assessment
    if (result.aiOverall) {
        const overallSelect = document.getElementById('capture-overall');
        overallSelect.value = result.aiOverall;
        applyAiStyling(overallSelect, confidenceLevel);
    }

    showDetectionResults(result, confidenceLevel);
}

/**
 * Get confidence level string.
 */
function getConfidenceLevel(confidence) {
    if (confidence >= 0.7) return 'high';
    if (confidence >= 0.4) return 'medium';
    return 'low';
}

/**
 * Apply AI-suggested styling to a form element.
 */
function applyAiStyling(element, level) {
    if (!element) return;
    element.classList.add('ai-suggested', `ai-${level}`);
}

/**
 * Remove AI styling from a single element (called on user override).
 */
function removeAiStyling(element) {
    if (!element) return;
    element.classList.remove('ai-suggested', 'ai-high', 'ai-medium', 'ai-low');
}

// --- Detection UI ---

function showDetectionStatus(message, progress) {
    const statusBar = document.getElementById('detection-status');
    const progressBar = document.getElementById('detection-progress-bar');
    const statusText = document.getElementById('detection-status-text');

    if (!statusBar) return;

    statusBar.style.display = 'block';

    if (statusText) statusText.textContent = message;

    if (progressBar) {
        if (progress < 0) {
            progressBar.style.width = '100%';
            progressBar.classList.add('error');
        } else {
            progressBar.style.width = progress + '%';
            progressBar.classList.remove('error');
        }
    }

    if (progress === 100 || progress < 0) {
        setTimeout(() => {
            if (statusBar) statusBar.style.display = 'none';
        }, 2000);
    }
}

function showDetectionResults(result, confidenceLevel) {
    const panel = document.getElementById('detection-results');
    if (!panel) return;

    const badgeClass = `confidence-badge ${confidenceLevel}`;
    const confidencePct = Math.round(result.confidence * 100);

    const source = result.visionApiUsed ? 'Vision AI'
        : result.mlIsFineTuned ? 'Local CV + ML'
        : 'Local CV';
    const sourceClass = result.visionApiUsed ? 'vision-source'
        : result.mlIsFineTuned ? 'ml-source'
        : 'cv-source';

    let html = `
        <div class="detection-header">
            <span class="${badgeClass}">
                ${confidenceLevel === 'high' ? 'AI' : confidenceLevel === 'medium' ? 'Verify' : 'Manual'}
                ${confidencePct}%
            </span>
            <span class="detection-source ${sourceClass}">${source}</span>
            <span class="detection-timing">${result.detectionDurationMs}ms</span>
        </div>
        <div class="detection-details">
            <p><strong>Colour:</strong> ${result.dominantColour || 'Unknown'}
               <strong>Shape:</strong> ${result.detectedShape || 'Unknown'}</p>
    `;

    if (result.aiCategory) {
        const catLabel = CATEGORY_LABELS[result.aiCategory] || result.aiCategory;
        html += `<p><strong>Category:</strong> ${catLabel}</p>`;
    }

    if (result.aiSignNumber) {
        const signLabel = SIGN_LABELS[result.aiSignNumber] || result.aiSignNumber;
        html += `<p><strong>Sign:</strong> ${signLabel}</p>`;
    }

    if (result.reasoning) {
        html += `<p class="detection-reasoning">${result.reasoning}</p>`;
    }

    if (result.conditionNotes) {
        html += `<p class="detection-condition"><strong>Condition:</strong> ${result.conditionNotes}</p>`;
    }

    if (confidenceLevel === 'low') {
        html += '<p class="detection-manual-msg">Low confidence — please classify manually</p>';
    }

    html += '</div>';

    if (confidenceLevel !== 'low') {
        html += `
            <div class="detection-actions">
                <button class="btn btn-small btn-accept" onclick="acceptDetection()">Accept</button>
                <button class="btn btn-small btn-reject" onclick="rejectDetection()">Reject</button>
            </div>
        `;
    }

    panel.innerHTML = html;
    panel.style.display = 'block';
}

function hideDetectionResults() {
    const panel = document.getElementById('detection-results');
    if (panel) panel.style.display = 'none';
}

function acceptDetection() {
    // Keep current values, hide action buttons
    const actions = document.querySelector('.detection-actions');
    if (actions) actions.style.display = 'none';
}

function rejectDetection() {
    // Clear AI-populated fields
    clearAiSuggestions();
    hideDetectionResults();
    lastDetectionResult = null;
}

function clearAiSuggestions() {
    // Remove AI styling from all elements
    document.querySelectorAll('.ai-suggested').forEach(el => {
        removeAiStyling(el);
    });

    // Reset form fields
    document.getElementById('capture-sign-category').value = '';
    document.getElementById('capture-sign-number').value = '';
    document.getElementById('capture-overall').value = '';
    document.querySelectorAll('.compliance-checklist input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });
}

// --- Override Tracking ---
// When user changes an AI-suggested field, remove the AI badge and track the override

function setupOverrideTracking() {
    const trackedFields = [
        { id: 'capture-sign-category', key: 'category' },
        { id: 'capture-sign-number', key: 'signNumber' },
        { id: 'capture-overall', key: 'overall' }
    ];

    for (const field of trackedFields) {
        const el = document.getElementById(field.id);
        if (el) {
            el.addEventListener('change', () => {
                removeAiStyling(el);
                if (lastDetectionResult) {
                    lastDetectionResult.auditorOverrides[field.key] = true;
                }
            });
        }
    }

    // Track checkbox overrides
    document.querySelectorAll('.compliance-checklist input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checkItem = cb.closest('.check-item');
            removeAiStyling(checkItem);
            if (lastDetectionResult) {
                const checkId = cb.id.replace('check-', '');
                if (!lastDetectionResult.auditorOverrides.checks.includes(checkId)) {
                    lastDetectionResult.auditorOverrides.checks.push(checkId);
                }
            }
        });
    });
}

// Initialize override tracking when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupOverrideTracking);
} else {
    setupOverrideTracking();
}
