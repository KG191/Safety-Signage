/**
 * Camera module — access device camera, capture photos, store as data URLs.
 * Uses the rear-facing camera by default (environment) for field auditing.
 * Two-phase capture: context photo (situation shot) → sign close-up.
 */

let cameraStream = null;
let cameraPhase = 'context'; // 'context' | 'sign'
let contextPhotoData = null;

const preview = document.getElementById('camera-preview');
const canvas = document.getElementById('camera-canvas');
const capturedImg = document.getElementById('captured-image');
const capturedContainer = document.getElementById('captured-image-container');
const btnStart = document.getElementById('btn-start-camera');
const btnTake = document.getElementById('btn-take-photo');
const btnRetake = document.getElementById('btn-retake');
const btnSkipContext = document.getElementById('btn-skip-context');
const phaseLabel = document.getElementById('camera-phase-label');
const contextThumbContainer = document.getElementById('context-thumb-container');
const contextThumb = document.getElementById('context-photo-thumb');
const btnRetakeContext = document.getElementById('btn-retake-context');

btnStart.addEventListener('click', startCamera);
btnTake.addEventListener('click', takePhoto);
btnRetake.addEventListener('click', retakePhoto);
btnSkipContext.addEventListener('click', skipContextPhoto);
btnRetakeContext.addEventListener('click', retakeContextPhoto);

async function startCamera() {
    // License gate: check before starting camera
    if (typeof checkLicenseForCamera === 'function') {
        const allowed = await checkLicenseForCamera();
        if (!allowed) return;
    }

    try {
        const constraints = {
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 960 }
            }
        };

        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        preview.srcObject = cameraStream;
        preview.style.display = 'block';
        capturedContainer.style.display = 'none';

        btnStart.style.display = 'none';
        btnTake.style.display = 'inline-block';
        btnRetake.style.display = 'none';

        updatePhaseUI();
    } catch (err) {
        alert('Could not access camera: ' + err.message);
    }
}

function updatePhaseUI() {
    if (cameraPhase === 'context') {
        phaseLabel.textContent = 'Step 1 of 2: Context Photo (wide-angle situation shot)';
        phaseLabel.style.display = 'block';
        btnSkipContext.style.display = 'inline-block';
    } else {
        phaseLabel.textContent = 'Step 2 of 2: Sign Close-up';
        phaseLabel.style.display = 'block';
        btnSkipContext.style.display = 'none';
    }
}

function takePhoto() {
    if (!cameraStream) return;

    const track = cameraStream.getVideoTracks()[0];
    const settings = track.getSettings();

    if (cameraPhase === 'context') {
        // Context photo: lower quality, capped at 800px wide
        const srcW = settings.width || preview.videoWidth;
        const srcH = settings.height || preview.videoHeight;
        const scale = srcW > 800 ? 800 / srcW : 1;
        canvas.width = Math.round(srcW * scale);
        canvas.height = Math.round(srcH * scale);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);

        contextPhotoData = canvas.toDataURL('image/jpeg', 0.5);

        // Show thumbnail, keep camera live, transition to sign phase
        contextThumb.src = contextPhotoData;
        contextThumbContainer.style.display = 'flex';

        cameraPhase = 'sign';
        updatePhaseUI();
        // Do NOT stop camera, do NOT run detection
    } else {
        // Sign close-up: existing behaviour
        canvas.width = settings.width || preview.videoWidth;
        canvas.height = settings.height || preview.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        capturedImg.src = dataUrl;

        // Trigger detection pipeline
        if (typeof runDetectionPipeline === 'function') runDetectionPipeline(dataUrl);

        // Stop camera to save battery
        stopCamera();

        preview.style.display = 'none';
        capturedContainer.style.display = 'block';
        btnTake.style.display = 'none';
        btnRetake.style.display = 'inline-block';
        phaseLabel.style.display = 'none';
    }
}

function skipContextPhoto() {
    contextPhotoData = null;
    cameraPhase = 'sign';
    updatePhaseUI();
}

function retakeContextPhoto() {
    contextPhotoData = null;
    contextThumbContainer.style.display = 'none';
    contextThumb.src = '';
    capturedImg.src = '';
    capturedContainer.style.display = 'none';
    cameraPhase = 'context';

    // Restart camera if it was stopped (sign photo was already taken)
    if (!cameraStream) {
        startCamera();
    } else {
        updatePhaseUI();
    }
}

function retakePhoto() {
    capturedImg.src = '';
    capturedContainer.style.display = 'none';
    // Keep context photo, restart at sign phase
    cameraPhase = 'sign';
    startCamera();
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    preview.srcObject = null;
}

function getContextPhoto() {
    return contextPhotoData;
}

function resetCameraPhase() {
    cameraPhase = 'context';
    contextPhotoData = null;
    contextThumbContainer.style.display = 'none';
    contextThumb.src = '';
    phaseLabel.style.display = 'none';
    btnSkipContext.style.display = 'none';
}

// Clean up camera when leaving page
window.addEventListener('beforeunload', stopCamera);
