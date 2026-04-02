/**
 * Report generation — summary statistics, compliance gap analysis, CSV export.
 */

const CATEGORY_LABELS = {
    prohibition: 'Prohibition',
    mandatory: 'Mandatory',
    restriction: 'Limitation / Restriction',
    danger: 'DANGER',
    warning: 'Warning',
    emergency: 'Emergency Information',
    fire: 'Fire'
};

const OVERALL_LABELS = {
    compliant: 'Compliant',
    'minor-nc': 'Minor Non-Compliance',
    'major-nc': 'Major Non-Compliance',
    missing: 'Missing Sign Required',
    redundant: 'Redundant'
};

const SIGN_LABELS = {
    '401': '401 - Smoking prohibited',
    '402': '402 - Fire/flame/smoking prohibited',
    '403': '403 - No pedestrian access',
    '404': '404 - Water not suitable for drinking',
    '405': '405 - Digging prohibited',
    '421': '421 - Eye protection',
    '422': '422 - Full face mask respiratory',
    '423': '423 - Half face mask respiratory',
    '424': '424 - Head protection',
    '425': '425 - Hearing protection',
    '426': '426 - Hand protection',
    '427': '427 - Foot protection',
    '428': '428 - Protective body clothing',
    '429': '429 - Face protection',
    '430': '430 - Long hair contained/covered',
    '441': '441 - Unspecified hazard',
    '442': '442 - Fire risk',
    '443': '443 - Explosion risk',
    '444': '444 - Toxic hazard',
    '445': '445 - Corrosion risk',
    '446': '446 - Ionizing radiation',
    '447': '447 - Electric shock risk',
    '448': '448 - Laser beam hazard',
    '449': '449 - Opening door hazard',
    '450': '450 - Forklifts hazard',
    '451': '451 - Non-ionizing radiation',
    '452': '452 - Biological hazard',
    '453': '453 - Guard dog hazard',
    '471': '471 - First aid',
    '472': '472 - Emergency eye wash',
    '473': '473 - Emergency shower',
    'word-only': 'Word-message sign only',
    'non-standard': 'Non-standard sign'
};

// --- Report Selector ---

async function refreshReportSelector() {
    const select = document.getElementById('report-audit-select');
    const audits = await getAllAudits();

    select.innerHTML = '<option value="">-- Select Audit --</option>';
    audits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    for (const audit of audits) {
        const opt = document.createElement('option');
        opt.value = audit.id;
        opt.textContent = `${audit.siteName} (${audit.date})`;
        select.appendChild(opt);
    }

    document.getElementById('btn-generate-report').disabled = true;
}

document.getElementById('report-audit-select').addEventListener('change', (e) => {
    document.getElementById('btn-generate-report').disabled = !e.target.value;
});

document.getElementById('btn-generate-report').addEventListener('click', async () => {
    const auditId = document.getElementById('report-audit-select').value;
    if (!auditId) return;
    const btn = document.getElementById('btn-generate-report');
    btn.disabled = true;
    btn.textContent = 'Generating...';
    try {
        await generateReport(auditId);
    } catch (err) {
        alert('Error generating report: ' + err.message);
        console.error('Report generation error:', err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Report';
    }
});

// --- Report Generation ---

async function generateReport(auditId) {
    const audit = await getAudit(auditId);
    const captures = await getCapturesByAudit(auditId);

    if (!audit) {
        alert('Audit not found. It may have been deleted.');
        return;
    }

    const compliant = captures.filter(c => c.overall === 'compliant').length;
    const minorNC = captures.filter(c => c.overall === 'minor-nc').length;
    const majorNC = captures.filter(c => c.overall === 'major-nc').length;
    const missing = captures.filter(c => c.overall === 'missing').length;
    const redundant = captures.filter(c => c.overall === 'redundant').length;
    const total = captures.length;

    const complianceRate = total > 0 ? Math.round((compliant / total) * 100) : 0;

    let html = `
        <h3>Safety Signage Audit Report</h3>
        <p><strong>Standard:</strong> AS 1319-1994 (Reconfirmed 2018)</p>
        <table>
            <tr><td><strong>Site</strong></td><td>${escapeHtml(audit.siteName)}</td></tr>
            <tr><td><strong>Client</strong></td><td>${escapeHtml(audit.client || '—')}</td></tr>
            <tr><td><strong>Auditor</strong></td><td>${escapeHtml(audit.auditor)}</td></tr>
            <tr><td><strong>Date</strong></td><td>${audit.date}</td></tr>
            ${audit.notes ? `<tr><td><strong>Notes</strong></td><td>${escapeHtml(audit.notes)}</td></tr>` : ''}
        </table>

        <h3>Summary</h3>
        <div class="report-summary-grid">
            <div class="report-summary-item">
                <div class="value">${total}</div>
                <div class="label">Total Signs</div>
            </div>
            <div class="report-summary-item">
                <div class="value" style="color:var(--success);">${complianceRate}%</div>
                <div class="label">Compliance Rate</div>
            </div>
            <div class="report-summary-item">
                <div class="value" style="color:var(--danger);">${majorNC + missing}</div>
                <div class="label">Critical Issues</div>
            </div>
        </div>

        <table>
            <tr><th>Assessment</th><th>Count</th></tr>
            <tr><td>Compliant</td><td>${compliant}</td></tr>
            <tr><td>Minor Non-Compliance</td><td>${minorNC}</td></tr>
            <tr><td>Major Non-Compliance</td><td>${majorNC}</td></tr>
            <tr><td>Missing Sign Required</td><td>${missing}</td></tr>
            <tr><td>Redundant</td><td>${redundant}</td></tr>
        </table>

        <h3>Signs by Category</h3>
        <table>
            <tr><th>Category</th><th>Count</th></tr>
            ${Object.entries(countByField(captures, 'category'))
                .map(([cat, count]) => `<tr><td>${CATEGORY_LABELS[cat] || cat}</td><td>${count}</td></tr>`)
                .join('')}
        </table>

        ${generateDetectionAnalytics(captures)}

        <h3>Detailed Findings</h3>
        <table>
            <tr>
                <th>#</th>
                <th>Photos</th>
                <th>Location</th>
                <th>Category</th>
                <th>Sign</th>
                <th>Assessment</th>
                <th>AI Conf.</th>
                <th>Override</th>
                <th>Notes</th>
            </tr>
            ${captures.map((c, i) => {
                const d = c.detection;
                const confPct = d ? Math.round(d.confidence * 100) + '%' : '—';
                const confLevel = d ? (d.confidence >= 0.7 ? 'high' : d.confidence >= 0.4 ? 'medium' : 'low') : '';
                const overridden = d && d.auditorOverrides ?
                    (d.auditorOverrides.category || d.auditorOverrides.signNumber || d.auditorOverrides.overall || (d.auditorOverrides.checks && d.auditorOverrides.checks.length > 0)) : false;
                const ctxHtml = c.contextPhoto
                    ? `<img src="${c.contextPhoto}" class="report-thumbnail report-thumbnail-ctx" alt="Context ${i + 1}" onclick="openPhotoModal(this.src)">`
                    : '';
                const signHtml = c.photo
                    ? `<img src="${c.photo}" class="report-thumbnail" alt="Sign ${i + 1}" onclick="openPhotoModal(this.src)">`
                    : '<small>No photo</small>';
                const photoHtml = `<div class="report-photo-pair">${ctxHtml}${signHtml}</div>`;
                return `
                <tr>
                    <td>${i + 1}</td>
                    <td>${photoHtml}</td>
                    <td>${escapeHtml(c.locationDesc || '—')}${c.lat ? `<br><small>${c.lat}, ${c.lng}</small>` : ''}</td>
                    <td>${CATEGORY_LABELS[c.category] || c.category}</td>
                    <td>${c.signNumber ? (SIGN_LABELS[c.signNumber] || c.signNumber) : '—'}${c.signText ? `<br><small>"${escapeHtml(c.signText)}"</small>` : ''}</td>
                    <td><span class="compliance-tag ${c.overall}">${OVERALL_LABELS[c.overall] || c.overall}</span></td>
                    <td>${confLevel ? `<span class="confidence-badge ${confLevel}">${confPct}</span>` : '—'}</td>
                    <td>${overridden ? 'Yes' : (d ? 'No' : '—')}</td>
                    <td>${escapeHtml(c.notes || '—')}</td>
                </tr>`;
            }).join('')}
        </table>

        ${generateGapAnalysis(captures)}
    `;

    document.getElementById('report-content').innerHTML = html;
    document.getElementById('report-output').style.display = 'block';
}

function generateGapAnalysis(captures) {
    const nonCompliant = captures.filter(c =>
        c.overall === 'minor-nc' || c.overall === 'major-nc' || c.overall === 'missing'
    );

    if (nonCompliant.length === 0) {
        return '<h3>Gap Analysis</h3><p>No compliance gaps identified.</p>';
    }

    // Analyse which compliance checks are most commonly failing
    const failureCounts = {};
    const checkLabels = {
        'correct-colour': 'Incorrect safety colour hue (Clause 2.2)',
        'correct-shape': 'Incorrect symbolic shape (Clause 2.2)',
        'correct-legend-colour': 'Incorrect legend colour (Table 3.1)',
        'correct-enclosure': 'White enclosure/border missing (Clause 2.2)',
        'correct-layout': 'Incorrect sign layout type (Clause 2.3)',
        'standard-symbol': 'Non-standard symbol used (Clause 3.1/3.2)',
        'adequate-size': 'Inadequate size for viewing distance (Clause 3.4)',
        'legible': 'Legend not legible (Clause 3.4)',
        'colour-fidelity': 'Colour faded from AS 2700 specification (Clause 3.5)',
        'visible': 'Sign not visible/obscured (Clause 4.2.1)',
        'location': 'Poor location/siting (Clause 4.2.2)',
        'mounting-height': 'Incorrect mounting height (Clause 4.2.2)',
        'not-moveable': 'Mounted on moveable object (Clause 4.2.4)',
        'condition': 'Poor surface condition/maintenance (Clause 4.3)',
        'construction-safe': 'Structurally unsound or fasteners insecure (Clause 4.1.1)',
        'illumination': 'Inadequate illumination (Clause 4.2.5)',
        'not-hazard': 'Sign creates a hazard (Clause 4.1)',
        'still-relevant': 'Sign no longer relevant (Clause 4.1)',
        'not-cluttered': 'Excessive sign clustering (Clause 4.2.6)',
        'tag-compliant': 'Tag does not meet Section 5 requirements'
    };

    for (const capture of nonCompliant) {
        if (!capture.checks) continue;
        for (const [key, passed] of Object.entries(capture.checks)) {
            if (!passed) {
                failureCounts[key] = (failureCounts[key] || 0) + 1;
            }
        }
    }

    const sorted = Object.entries(failureCounts)
        .sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
        return '<h3>Gap Analysis</h3><p>No specific compliance check failures recorded.</p>';
    }

    let html = `
        <h3>Gap Analysis — Most Common Issues</h3>
        <table>
            <tr><th>Issue (AS 1319 Reference)</th><th>Occurrences</th></tr>
            ${sorted.map(([key, count]) =>
                `<tr><td>${checkLabels[key] || key}</td><td>${count}</td></tr>`
            ).join('')}
        </table>
        <h3>Recommendations</h3>
        <ul>
    `;

    // Generate recommendations based on top failures
    for (const [key] of sorted.slice(0, 5)) {
        html += `<li>${getRecommendation(key)}</li>`;
    }

    html += '</ul>';
    return html;
}

function getRecommendation(checkKey) {
    const recommendations = {
        'correct-colour': 'Replace non-compliant signs with signs using correct AS 1319 safety colours (Table 3.2): Red R13, Yellow Y15, Green G21, Blue B23.',
        'correct-shape': 'Ensure signs use the correct symbolic shapes per Table 2.1: circle for regulatory, triangle for warning, rectangle for emergency/fire.',
        'correct-legend-colour': 'Verify legend colours per Table 3.1: black on white/yellow backgrounds, white on green/red backgrounds.',
        'correct-enclosure': 'Add or restore white enclosure border per Clause 2.2. Emergency, fire, and prohibition signs require a white border or interior.',
        'correct-layout': 'Review sign layout type — hybrid signs (words repeating symbol meaning) are deprecated per Clause 2.3.3(d). Use symbol-only or composite layouts.',
        'standard-symbol': 'Replace non-standard symbols with AS 1319 Appendix B standard symbolic signs. Any new symbols must be tested per AS 2342.',
        'adequate-size': 'Increase sign size to meet Clause 3.4.2 minimums: 15mm per metre of viewing distance for symbols, 5mm per metre for upper case letters.',
        'legible': 'Improve sign legibility — consider larger letter sizes, better contrast, or repositioning closer to the intended viewing area.',
        'colour-fidelity': 'Repaint or replace sign — colours have faded from the AS 2700 specification (Clause 3.5). Reference colours: Red R13, Yellow Y15, Green G21, Blue B23.',
        'visible': 'Relocate or clear obstructions to ensure signs are clearly visible. Consider contrast with surroundings (Clause 4.2.1).',
        'location': 'Reposition signs closer to observer line of sight. Ensure adequate advance warning distance for hazards (Clause 4.2.2-4.2.3).',
        'mounting-height': 'Relocate sign to approximately 1500mm above floor level per Clause 4.2.2.',
        'not-moveable': 'Relocate sign from moveable object (door, gate) to a fixed surface per Clause 4.2.4, so it remains visible at all times.',
        'condition': 'Implement regular sign maintenance program. Replace faded, damaged, or deteriorating signs promptly (Clause 4.3).',
        'construction-safe': 'Repair or replace sign — construction or fasteners are inadequate per Clause 4.1.1. Ensure edges are not sharp and mounting is secure.',
        'illumination': 'Provide external or internal illumination where ambient lighting is insufficient. Consider retroreflective materials for signs needing visibility in low light (Clause 3.5.2).',
        'not-hazard': 'Reposition signs that project into passageways or could be struck by persons, vehicles or mobile plant (Clause 4.1).',
        'still-relevant': 'Remove signs that are no longer relevant to current conditions. Leaving outdated signs may induce disrespect for all signage (Clause 4.1).',
        'not-cluttered': 'Reduce sign clustering at this location. Excessive signage reduces comprehension of individual messages (Clause 4.2.6).',
        'tag-compliant': 'Replace tag to meet Section 5 requirements of AS 1319. Ensure correct format, colour coding, and attachment method.'
    };
    return recommendations[checkKey] || `Address compliance issue: ${checkKey}`;
}

// --- Detection Analytics ---

function generateDetectionAnalytics(captures) {
    const withDetection = captures.filter(c => c.detection && c.detection.confidence != null);
    if (withDetection.length === 0) return '';

    const total = captures.length;
    const aiCoverage = Math.round((withDetection.length / total) * 100);

    const overridden = withDetection.filter(c => {
        const o = c.detection.auditorOverrides;
        return o && (o.category || o.signNumber || o.overall || (o.checks && o.checks.length > 0));
    });
    const overrideRate = Math.round((overridden.length / withDetection.length) * 100);

    const highConf = withDetection.filter(c => c.detection.confidence >= 0.7).length;
    const medConf = withDetection.filter(c => c.detection.confidence >= 0.4 && c.detection.confidence < 0.7).length;
    const lowConf = withDetection.filter(c => c.detection.confidence < 0.4).length;

    const avgConf = Math.round(
        (withDetection.reduce((s, c) => s + c.detection.confidence, 0) / withDetection.length) * 100
    );

    return `
        <h3>Detection Analytics</h3>
        <div class="report-summary-grid">
            <div class="report-summary-item">
                <div class="value">${aiCoverage}%</div>
                <div class="label">AI Coverage</div>
            </div>
            <div class="report-summary-item">
                <div class="value">${overrideRate}%</div>
                <div class="label">Override Rate</div>
            </div>
            <div class="report-summary-item">
                <div class="value">${avgConf}%</div>
                <div class="label">Avg Confidence</div>
            </div>
        </div>
        <table>
            <tr><th>Confidence Level</th><th>Count</th></tr>
            <tr><td><span class="confidence-badge high">High (&ge;70%)</span></td><td>${highConf}</td></tr>
            <tr><td><span class="confidence-badge medium">Medium (40-69%)</span></td><td>${medConf}</td></tr>
            <tr><td><span class="confidence-badge low">Low (&lt;40%)</span></td><td>${lowConf}</td></tr>
        </table>
    `;
}

// --- CSV Export (Two Versions) ---

document.getElementById('btn-export-csv').addEventListener('click', async () => {
    const auditId = document.getElementById('report-audit-select').value;
    if (!auditId) return;

    const audit = await getAudit(auditId);
    const captures = await getCapturesByAudit(auditId);
    const siteSlug = audit.siteName.replace(/\s+/g, '-');

    const headers = [
        'Item', 'Location', 'Latitude', 'Longitude', 'Category', 'Sign Number',
        'Sign Text', 'Overall Assessment',
        'Colour OK', 'Shape OK', 'Legend Colour OK', 'Enclosure OK', 'Layout OK',
        'Standard Symbol', 'Adequate Size', 'Legible', 'Colour Fidelity',
        'Visible', 'Location OK', 'Mounting Height', 'Not Moveable',
        'Condition OK', 'Construction Safe', 'Illumination OK',
        'No Hazard', 'Still Relevant', 'Not Cluttered', 'Tag Compliant',
        'Notes', 'Captured At'
    ];

    const checkVal = (ch, key) => ch[key] === true ? 'Yes' : ch[key] === false ? 'No' : 'N/A';

    // --- Build ORIGINAL (AI) rows ---
    const originalRows = captures.map((c, i) => {
        const d = c.detection || {};
        // Use AI-original values where available, fall back to saved values if no detection
        const origCategory = d.aiCategory || c.category;
        const origSignNumber = d.aiSignNumber || c.signNumber;
        const origOverall = d.aiOverall || c.overall;
        const origChecks = d.aiChecks || c.checks || {};
        return [
            i + 1,
            c.locationDesc || '',
            c.lat || '',
            c.lng || '',
            CATEGORY_LABELS[origCategory] || origCategory,
            origSignNumber || '',
            c.signText || '',
            OVERALL_LABELS[origOverall] || origOverall,
            checkVal(origChecks, 'correct-colour'),
            checkVal(origChecks, 'correct-shape'),
            checkVal(origChecks, 'correct-legend-colour'),
            checkVal(origChecks, 'correct-enclosure'),
            checkVal(origChecks, 'correct-layout'),
            checkVal(origChecks, 'standard-symbol'),
            checkVal(origChecks, 'adequate-size'),
            checkVal(origChecks, 'legible'),
            checkVal(origChecks, 'colour-fidelity'),
            checkVal(origChecks, 'visible'),
            checkVal(origChecks, 'location'),
            checkVal(origChecks, 'mounting-height'),
            checkVal(origChecks, 'not-moveable'),
            checkVal(origChecks, 'condition'),
            checkVal(origChecks, 'construction-safe'),
            checkVal(origChecks, 'illumination'),
            checkVal(origChecks, 'not-hazard'),
            checkVal(origChecks, 'still-relevant'),
            checkVal(origChecks, 'not-cluttered'),
            checkVal(origChecks, 'tag-compliant'),
            c.notes || '',
            c.capturedAt || ''
        ];
    });

    // --- Build FINAL (auditor-reviewed) rows ---
    const finalRows = captures.map((c, i) => {
        const ch = c.checks || {};
        return [
            i + 1,
            c.locationDesc || '',
            c.lat || '',
            c.lng || '',
            CATEGORY_LABELS[c.category] || c.category,
            c.signNumber || '',
            c.signText || '',
            OVERALL_LABELS[c.overall] || c.overall,
            checkVal(ch, 'correct-colour'),
            checkVal(ch, 'correct-shape'),
            checkVal(ch, 'correct-legend-colour'),
            checkVal(ch, 'correct-enclosure'),
            checkVal(ch, 'correct-layout'),
            checkVal(ch, 'standard-symbol'),
            checkVal(ch, 'adequate-size'),
            checkVal(ch, 'legible'),
            checkVal(ch, 'colour-fidelity'),
            checkVal(ch, 'visible'),
            checkVal(ch, 'location'),
            checkVal(ch, 'mounting-height'),
            checkVal(ch, 'not-moveable'),
            checkVal(ch, 'condition'),
            checkVal(ch, 'construction-safe'),
            checkVal(ch, 'illumination'),
            checkVal(ch, 'not-hazard'),
            checkVal(ch, 'still-relevant'),
            checkVal(ch, 'not-cluttered'),
            checkVal(ch, 'tag-compliant'),
            c.notes || '',
            c.capturedAt || ''
        ];
    });

    // Download both files
    downloadCsv(headers, originalRows, `audit-${siteSlug}-${audit.date}-ORIGINAL.csv`);
    setTimeout(() => {
        downloadCsv(headers, finalRows, `audit-${siteSlug}-${audit.date}-FINAL.csv`);
    }, 500);
});

function downloadCsv(headers, rows, filename) {
    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    // Try Web Share API (works on iOS Safari)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename)] })) {
        const file = new File([blob], filename, { type: 'text/csv' });
        navigator.share({ files: [file], title: filename }).catch(() => {});
        return;
    }

    // Fallback: programmatic download (works on desktop browsers)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Print ---

document.getElementById('btn-print-report').addEventListener('click', () => {
    window.print();
});

// --- Photo Modal ---

function openPhotoModal(src) {
    // Remove existing modal if any
    const existing = document.getElementById('photo-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'photo-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:1rem;cursor:pointer;';
    modal.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;">`;
    modal.addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);
}

// --- Helpers ---

function countByField(items, field) {
    const counts = {};
    for (const item of items) {
        const val = item[field];
        counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
}
