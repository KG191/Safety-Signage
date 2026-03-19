/**
 * Main application logic — navigation, audit management, capture form handling.
 */

// --- Cover Screen ---

(function initCoverScreen() {
    const cover = document.getElementById('cover-screen');
    const enterBtn = document.getElementById('cover-enter-btn');
    if (!cover || !enterBtn) return;

    // Hide app behind cover using body class (`:has()` not supported on all mobile browsers)
    document.body.classList.add('cover-active');

    function dismissCover(e) {
        e.preventDefault();
        e.stopPropagation();
        if (cover.classList.contains('hidden')) return;
        cover.classList.add('hidden');

        if (localStorage.getItem('eula-accepted')) {
            // EULA already accepted — go straight to app
            document.body.classList.remove('cover-active');
        } else {
            // Show EULA screen
            document.getElementById('eula-screen').style.display = 'flex';
        }

        cover.addEventListener('transitionend', () => cover.remove(), { once: true });
    }

    enterBtn.addEventListener('click', dismissCover);
    enterBtn.addEventListener('touchend', dismissCover);
})();

// --- EULA Screen ---

(function initEulaScreen() {
    const eulaScreen = document.getElementById('eula-screen');
    const checkbox = document.getElementById('eula-checkbox');
    const continueBtn = document.getElementById('eula-continue-btn');
    if (!eulaScreen || !checkbox || !continueBtn) return;

    checkbox.addEventListener('change', () => {
        continueBtn.disabled = !checkbox.checked;
    });

    continueBtn.addEventListener('click', () => {
        localStorage.setItem('eula-accepted', Date.now());
        eulaScreen.classList.add('hidden');
        document.body.classList.remove('cover-active');
        eulaScreen.addEventListener('transitionend', () => {
            eulaScreen.style.display = 'none';
        }, { once: true });
    });
})();

let currentAuditId = null;

// --- Navigation ---

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const viewName = btn.dataset.view;
        switchView(viewName);
    });
});

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const view = document.getElementById(`view-${viewName}`);
    const navBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);

    if (view) view.classList.add('active');
    if (navBtn) navBtn.classList.add('active');

    // Refresh data when switching views
    if (viewName === 'dashboard') refreshDashboard();
    if (viewName === 'capture') refreshCaptureView();
    if (viewName === 'reports') refreshReportSelector();
    if (viewName === 'settings' && typeof refreshBackupStats === 'function') refreshBackupStats();
}

// --- Dashboard ---

async function refreshDashboard() {
    const audits = await getAllAudits();
    const allCaptures = await getAllCaptures();

    // Stats
    document.getElementById('stat-total-audits').textContent = audits.length;
    document.getElementById('stat-total-signs').textContent = allCaptures.length;
    document.getElementById('stat-compliant').textContent =
        allCaptures.filter(c => c.overall === 'compliant').length;
    document.getElementById('stat-non-compliant').textContent =
        allCaptures.filter(c => c.overall === 'major-nc' || c.overall === 'minor-nc').length;

    // Audit list
    const listEl = document.getElementById('audit-list');
    if (audits.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No audits yet. Start a new audit to begin.</p>';
        return;
    }

    // Sort newest first
    audits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    let html = '';
    for (const audit of audits) {
        const captures = allCaptures.filter(c => c.auditId === audit.id);
        html += `
            <div class="audit-swipe-wrapper" data-audit-id="${audit.id}">
                <div class="audit-list-item">
                    <div class="audit-info">
                        <strong>${escapeHtml(audit.siteName)}</strong>
                        <span>${audit.date} — ${escapeHtml(audit.auditor)}</span>
                    </div>
                    <span class="audit-count">${captures.length} signs</span>
                </div>
                <button class="audit-delete-btn" aria-label="Delete audit">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                </button>
            </div>
        `;
    }
    listEl.innerHTML = html;

    // Wire up swipe-to-delete and tap-to-open
    listEl.querySelectorAll('.audit-swipe-wrapper').forEach(wrapper => {
        const item = wrapper.querySelector('.audit-list-item');
        const deleteBtn = wrapper.querySelector('.audit-delete-btn');
        let startX = 0, currentX = 0, swiping = false;

        item.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            currentX = startX;
            swiping = true;
            item.style.transition = 'none';
        }, { passive: true });

        item.addEventListener('touchmove', (e) => {
            if (!swiping) return;
            currentX = e.touches[0].clientX;
            const dx = Math.min(0, currentX - startX); // only swipe left
            item.style.transform = `translateX(${dx}px)`;
        }, { passive: true });

        item.addEventListener('touchend', () => {
            if (!swiping) return;
            swiping = false;
            item.style.transition = 'transform 0.25s ease';
            const dx = currentX - startX;
            if (dx < -60) {
                // Reveal delete button
                item.style.transform = 'translateX(-64px)';
                wrapper.classList.add('swiped');
            } else {
                item.style.transform = 'translateX(0)';
                wrapper.classList.remove('swiped');
            }
        });

        // Tap on item navigates to capture (only if not swiped)
        item.addEventListener('click', () => {
            if (wrapper.classList.contains('swiped')) {
                // Close swipe
                item.style.transition = 'transform 0.25s ease';
                item.style.transform = 'translateX(0)';
                wrapper.classList.remove('swiped');
                return;
            }
            currentAuditId = wrapper.dataset.auditId;
            switchView('capture');
        });

        // Delete button
        deleteBtn.addEventListener('click', async () => {
            if (!confirm('Delete this audit and all its captures?')) return;
            try {
                await deleteAudit(wrapper.dataset.auditId);
                if (currentAuditId === wrapper.dataset.auditId) currentAuditId = null;
                refreshDashboard();
            } catch (err) {
                alert('Error deleting audit: ' + err.message);
            }
        });
    });
}

// --- New Audit Form ---

document.getElementById('audit-date').valueAsDate = new Date();

document.getElementById('new-audit-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const auditData = {
        siteName: document.getElementById('audit-site-name').value.trim(),
        client: document.getElementById('audit-client').value.trim(),
        auditor: document.getElementById('audit-auditor').value.trim(),
        date: document.getElementById('audit-date').value,
        notes: document.getElementById('audit-notes').value.trim()
    };

    const audit = await createAudit(auditData);
    currentAuditId = audit.id;
    e.target.reset();
    document.getElementById('audit-date').valueAsDate = new Date();
    switchView('capture');
});

// --- Capture View ---

function refreshCaptureView() {
    const label = document.getElementById('capture-audit-label');
    const saveBtn = document.getElementById('btn-save-capture');

    if (!currentAuditId) {
        label.textContent = 'No audit selected — create or select an audit first.';
        saveBtn.disabled = true;
        return;
    }

    getAudit(currentAuditId).then(audit => {
        if (audit) {
            label.textContent = `Auditing: ${audit.siteName} (${audit.date})`;
            saveBtn.disabled = false;
        }
    });

    // Preload ML model when entering Capture view
    if (typeof loadMLModel === 'function') loadMLModel();
}

// --- GPS ---

document.getElementById('btn-get-gps').addEventListener('click', () => {
    const gpsText = document.getElementById('gps-text');
    gpsText.textContent = 'Acquiring location...';

    if (!navigator.geolocation) {
        gpsText.textContent = 'Geolocation not supported by this browser.';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude.toFixed(6);
            const lng = position.coords.longitude.toFixed(6);
            const acc = position.coords.accuracy.toFixed(0);
            document.getElementById('capture-lat').value = lat;
            document.getElementById('capture-lng').value = lng;
            gpsText.textContent = `${lat}, ${lng} (±${acc}m)`;
        },
        (error) => {
            gpsText.textContent = `Location error: ${error.message}`;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
});

// --- Save Capture ---

document.getElementById('btn-save-capture').addEventListener('click', async () => {
    if (!currentAuditId) {
        alert('Please select or create an audit first.');
        return;
    }

    const category = document.getElementById('capture-sign-category').value;
    const overall = document.getElementById('capture-overall').value;

    if (!category) {
        alert('Please select a sign category.');
        return;
    }
    if (!overall) {
        alert('Please select an overall assessment.');
        return;
    }

    // Gather compliance checks
    const checks = {};
    document.querySelectorAll('.compliance-checklist input[type="checkbox"]').forEach(cb => {
        checks[cb.id.replace('check-', '')] = cb.checked;
    });

    const captureData = {
        auditId: currentAuditId,
        photo: document.getElementById('captured-image').src || null,
        lat: document.getElementById('capture-lat').value || null,
        lng: document.getElementById('capture-lng').value || null,
        locationDesc: document.getElementById('capture-location-desc').value.trim(),
        category: category,
        signNumber: document.getElementById('capture-sign-number').value,
        signText: document.getElementById('capture-sign-text').value.trim(),
        checks: checks,
        overall: overall,
        notes: document.getElementById('capture-notes').value.trim(),
        detection: typeof lastDetectionResult !== 'undefined' ? lastDetectionResult : null,
        contextPhoto: typeof getContextPhoto === 'function' ? getContextPhoto() : null
    };

    await saveCapture(captureData);

    // Reset form for next capture
    resetCaptureForm();
    alert('Signage record saved.');
});

function resetCaptureForm() {
    document.getElementById('capture-sign-category').value = '';
    document.getElementById('capture-sign-number').value = '';
    document.getElementById('capture-sign-text').value = '';
    document.getElementById('capture-overall').value = '';
    document.getElementById('capture-notes').value = '';
    document.getElementById('capture-location-desc').value = '';

    document.querySelectorAll('.compliance-checklist input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });

    // Reset photo and camera — stop any existing stream so a fresh one can start
    if (typeof stopCamera === 'function') stopCamera();
    const img = document.getElementById('captured-image');
    img.src = '';
    document.getElementById('captured-image-container').style.display = 'none';
    document.getElementById('camera-preview').style.display = 'none';
    document.getElementById('btn-start-camera').style.display = 'inline-block';
    document.getElementById('btn-take-photo').style.display = 'none';
    document.getElementById('btn-retake').style.display = 'none';

    // Reset context photo phase
    if (typeof resetCameraPhase === 'function') resetCameraPhase();

    // Hide detection results and clear AI styling
    if (typeof hideDetectionResults === 'function') hideDetectionResults();
    if (typeof lastDetectionResult !== 'undefined') lastDetectionResult = null;
    document.querySelectorAll('.ai-suggested').forEach(el => {
        el.classList.remove('ai-suggested', 'ai-high', 'ai-medium', 'ai-low');
    });

    // Hide tag checks group
    const tagGroup = document.getElementById('tag-checks-group');
    if (tagGroup) tagGroup.style.display = 'none';

    // Keep GPS from previous capture (common to re-use at same location)
}

// --- Tag checks conditional visibility ---
// Show the Tags (Section 5) check group only when the sign text suggests a tag
function updateTagCheckVisibility() {
    const tagGroup = document.getElementById('tag-checks-group');
    if (!tagGroup) return;

    const signText = (document.getElementById('capture-sign-text').value || '').toLowerCase();
    const notes = (document.getElementById('capture-notes').value || '').toLowerCase();

    // Show tag checks if "tag" appears in sign text or notes
    const isTag = signText.includes('tag') || notes.includes('tag') ||
                  signText.includes('lockout') || signText.includes('tagout');
    tagGroup.style.display = isTag ? 'block' : 'none';
}

// Listen for text changes that might indicate a tag
document.getElementById('capture-sign-text').addEventListener('input', updateTagCheckVisibility);
document.getElementById('capture-notes').addEventListener('input', updateTagCheckVisibility);

// --- Utility ---

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Init ---
refreshDashboard();
