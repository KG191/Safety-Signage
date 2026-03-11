/**
 * Camera module — access device camera, capture photos, store as data URLs.
 * Uses the rear-facing camera by default (environment) for field auditing.
 */

let cameraStream = null;

const preview = document.getElementById('camera-preview');
const canvas = document.getElementById('camera-canvas');
const capturedImg = document.getElementById('captured-image');
const capturedContainer = document.getElementById('captured-image-container');
const btnStart = document.getElementById('btn-start-camera');
const btnTake = document.getElementById('btn-take-photo');
const btnRetake = document.getElementById('btn-retake');

btnStart.addEventListener('click', startCamera);
btnTake.addEventListener('click', takePhoto);
btnRetake.addEventListener('click', retakePhoto);

async function startCamera() {
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
    } catch (err) {
        alert('Could not access camera: ' + err.message);
    }
}

function takePhoto() {
    if (!cameraStream) return;

    const track = cameraStream.getVideoTracks()[0];
    const settings = track.getSettings();
    canvas.width = settings.width || preview.videoWidth;
    canvas.height = settings.height || preview.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);

    // Compress to JPEG to save storage space
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    capturedImg.src = dataUrl;

    // Trigger detection pipeline (loosely coupled — works even if detection scripts fail)
    if (typeof runDetectionPipeline === 'function') runDetectionPipeline(dataUrl);

    // Stop camera to save battery
    stopCamera();

    preview.style.display = 'none';
    capturedContainer.style.display = 'block';
    btnTake.style.display = 'none';
    btnRetake.style.display = 'inline-block';
}

function retakePhoto() {
    capturedImg.src = '';
    capturedContainer.style.display = 'none';
    startCamera();
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    preview.srcObject = null;
}

// Clean up camera when leaving page
window.addEventListener('beforeunload', stopCamera);
