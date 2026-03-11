/**
 * ML Loader — Lazy-loads TensorFlow.js and a safety sign category classifier.
 *
 * Model strategy:
 *   PRIMARY: Custom MobileNet v3 Small fine-tuned on ORP-SIG-2024 (ISO 7010 → AS 1319)
 *            Outputs 7 AS 1319 categories via softmax. ~4-6MB hosted on CDN.
 *   FALLBACK: MobileNet v2 (ImageNet) with keyword-based lookup table (legacy).
 *
 * The fine-tuned model is expected at MODEL_CDN_URL as a TF.js GraphModel
 * (model.json + shard files). If unavailable, falls back to legacy MobileNet.
 */

let mlModel = null;
let mlLoading = false;
let mlAvailable = false;

/** Whether the loaded model is the fine-tuned AS 1319 category model */
let mlIsFineTuned = false;

/**
 * CDN URL for the fine-tuned AS 1319 category classifier.
 * Set via Settings or override here after training + hosting.
 */
let MODEL_CDN_URL = localStorage.getItem('ml-model-url') ||
    'models/as1319-v1/model.json';

/** AS 1319 category labels — output order matches model training */
const AS1319_CATEGORIES = [
    'prohibition',   // 0 — ISO 7010 P-series
    'mandatory',     // 1 — ISO 7010 M-series
    'restriction',   // 2 — AS 1319 specific (red circle, no slash)
    'warning',       // 3 — ISO 7010 W-series
    'danger',        // 4 — ISO 7010 danger / AS 1319 DANGER word-only
    'emergency',     // 5 — ISO 7010 E-series
    'fire'           // 6 — ISO 7010 F-series
];

/** Legacy ImageNet label substrings → AS 1319 sign numbers (fallback only) */
const IMAGENET_TO_AS1319 = {
    'no smoking':       '401',
    'cigarette':        '401',
    'fire hydrant':     '402',
    'no entry':         '403',
    'pedestrian':       '403',
    'hard hat':         '424',
    'helmet':           '424',
    'safety helmet':    '424',
    'ear plug':         '425',
    'headphone':        '425',
    'glove':            '426',
    'boot':             '427',
    'safety shoe':      '427',
    'goggles':          '421',
    'safety glass':     '421',
    'gas mask':         '422',
    'respirator':       '423',
    'skull':            '444',
    'poison':           '444',
    'biohazard':        '452',
    'radiation':        '446',
    'electric':         '447',
    'voltage':          '447',
    'lightning':        '447',
    'laser':            '448',
    'forklift':         '450',
    'first aid':        '471',
    'red cross':        '471',
    'shower':           '473',
    'eye wash':         '472',
    'exit sign':        'emergency',
    'fire escape':      'emergency',
    'danger':           'danger',
    'warning sign':     'warning',
    'traffic sign':     'warning',
    'stop sign':        'prohibition'
};

/**
 * Load TensorFlow.js and the ML model lazily from CDN.
 * Tries the fine-tuned AS 1319 model first, falls back to legacy MobileNet.
 * Call this when entering Capture view to preload.
 * @returns {Promise<boolean>} Whether a model loaded successfully
 */
async function loadMLModel() {
    if (mlModel) return true;
    if (mlLoading) return false;

    mlLoading = true;

    try {
        // Load TF.js (needed for both model types)
        if (typeof tf === 'undefined') {
            await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');
        }

        // Try fine-tuned model first (unless A/B toggle forces legacy)
        const forceLegacy = localStorage.getItem('ml-force-legacy') === 'true';
        if (!forceLegacy) {
            try {
                mlModel = await tf.loadGraphModel(MODEL_CDN_URL);
                mlIsFineTuned = true;
                mlAvailable = true;
                mlLoading = false;
                console.log('[ML] Fine-tuned AS 1319 category model loaded');
                dispatchModelStatusEvent('fine-tuned');
                return true;
            } catch (ftErr) {
                console.warn('[ML] Fine-tuned model unavailable, trying legacy MobileNet:', ftErr.message);
            }
        } else {
            console.log('[ML] A/B toggle: forcing legacy MobileNet');
        }

        // Fallback: legacy MobileNet v2
        if (typeof mobilenet === 'undefined') {
            await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0/dist/mobilenet.min.js');
        }

        mlModel = await mobilenet.load({ version: 2, alpha: 0.5 });
        mlIsFineTuned = false;
        mlAvailable = true;
        mlLoading = false;
        console.log('[ML] Legacy MobileNet loaded (ImageNet fallback)');
        dispatchModelStatusEvent('legacy');
        return true;
    } catch (err) {
        console.warn('[ML] Failed to load any ML model (offline or CDN unavailable):', err.message);
        mlLoading = false;
        mlAvailable = false;
        dispatchModelStatusEvent('unavailable');
        return false;
    }
}

/**
 * Dynamically load a script from URL.
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

/**
 * Run ML classification on an image element.
 *
 * Fine-tuned model: preprocesses to 224x224, normalises to [-1,1], runs
 * softmax → returns { category, confidence }.
 *
 * Legacy MobileNet: runs ImageNet classification → maps to sign numbers
 * via keyword lookup → returns { signNumber, confidence, label }.
 *
 * @param {HTMLImageElement} imgElement
 * @returns {Promise<object|null>} Classification result or null
 */
async function classifyWithML(imgElement) {
    if (!mlModel) return null;

    try {
        if (mlIsFineTuned) {
            return await classifyWithFineTunedModel(imgElement);
        } else {
            return await classifyWithLegacyMobileNet(imgElement);
        }
    } catch (err) {
        console.warn('[ML] Classification failed:', err.message);
        return null;
    }
}

/**
 * Classify using the fine-tuned AS 1319 category model.
 * @param {HTMLImageElement} imgElement
 * @returns {Promise<object|null>}
 */
async function classifyWithFineTunedModel(imgElement) {
    // Preprocess: resize to 224x224, normalize pixel values to [-1, 1]
    const tensor = tf.tidy(() => {
        const img = tf.browser.fromPixels(imgElement);
        const resized = tf.image.resizeBilinear(img, [224, 224]);
        const normalized = resized.toFloat().div(127.5).sub(1); // [-1, 1]
        return normalized.expandDims(0); // Add batch dimension
    });

    const predictions = await mlModel.predict(tensor);
    const probabilities = await predictions.data();

    // Clean up tensors
    tensor.dispose();
    predictions.dispose();

    // Find top prediction
    let maxIdx = 0;
    let maxProb = 0;
    for (let i = 0; i < probabilities.length; i++) {
        if (probabilities[i] > maxProb) {
            maxProb = probabilities[i];
            maxIdx = i;
        }
    }

    // Build sorted top-3 for debugging/display
    const ranked = Array.from(probabilities)
        .map((p, i) => ({ category: AS1319_CATEGORIES[i], probability: p }))
        .sort((a, b) => b.probability - a.probability);

    const topCategory = AS1319_CATEGORIES[maxIdx];
    if (!topCategory || maxProb < 0.1) return null;

    return {
        category: topCategory,
        confidence: maxProb,
        isFineTuned: true,
        topPredictions: ranked.slice(0, 3),
        // No specific sign number from category model — that's Phase 2
        signNumber: null,
        label: `AS 1319: ${topCategory} (${Math.round(maxProb * 100)}%)`
    };
}

/**
 * Classify using legacy MobileNet (ImageNet) with keyword mapping.
 * @param {HTMLImageElement} imgElement
 * @returns {Promise<object|null>}
 */
async function classifyWithLegacyMobileNet(imgElement) {
    const predictions = await mlModel.classify(imgElement, 5);

    for (const pred of predictions) {
        const label = pred.className.toLowerCase();
        for (const [keyword, signNum] of Object.entries(IMAGENET_TO_AS1319)) {
            if (label.includes(keyword)) {
                return {
                    signNumber: signNum,
                    confidence: pred.probability,
                    label: pred.className,
                    isFineTuned: false,
                    category: null
                };
            }
        }
    }

    return null;
}

/**
 * Update the custom model CDN URL and persist to localStorage.
 * @param {string} url
 */
function setModelCDNUrl(url) {
    MODEL_CDN_URL = url;
    localStorage.setItem('ml-model-url', url);
    // Reset model so next loadMLModel() fetches the new one
    mlModel = null;
    mlIsFineTuned = false;
    mlAvailable = false;
}

/**
 * Dispatch a custom event so UI can react to model status changes.
 * @param {'fine-tuned'|'legacy'|'unavailable'} status
 */
function dispatchModelStatusEvent(status) {
    window.dispatchEvent(new CustomEvent('ml-model-status', {
        detail: { status, isFineTuned: mlIsFineTuned }
    }));
    updateMLIndicator(status);
}

// --- ML Settings Panel Logic ---

function initMLSettings() {
    const urlInput = document.getElementById('ml-model-url');
    const abToggle = document.getElementById('ml-ab-toggle');
    const saveBtn = document.getElementById('btn-save-ml-settings');
    const statusEl = document.getElementById('ml-settings-status');

    if (!urlInput) return;

    // Load current values
    urlInput.value = localStorage.getItem('ml-model-url') || '';
    if (abToggle) {
        abToggle.checked = localStorage.getItem('ml-force-legacy') === 'true';
    }

    saveBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url) {
            setModelCDNUrl(url);
        } else {
            localStorage.removeItem('ml-model-url');
        }

        if (abToggle) {
            localStorage.setItem('ml-force-legacy', abToggle.checked);
        }

        statusEl.textContent = 'Settings saved. Model will reload on next capture.';
        statusEl.classList.add('visible');
        setTimeout(() => statusEl.classList.remove('visible'), 3000);
    });

    // Listen for model status changes
    window.addEventListener('ml-model-status', (e) => {
        updateMLIndicator(e.detail.status);
    });
}

function updateMLIndicator(status) {
    const indicator = document.getElementById('ml-model-indicator');
    if (!indicator) return;

    indicator.classList.remove('active', 'inactive', 'legacy');

    switch (status) {
        case 'fine-tuned':
            indicator.textContent = 'Fine-tuned AS 1319 model loaded';
            indicator.classList.add('active');
            break;
        case 'legacy':
            indicator.textContent = 'Legacy MobileNet (ImageNet fallback)';
            indicator.classList.add('legacy');
            break;
        default:
            indicator.textContent = 'Not loaded';
            indicator.classList.add('inactive');
    }
}

// Initialise ML settings when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMLSettings);
} else {
    initMLSettings();
}
