/**
 * Backup & Restore — export/import all audit data (including photos) as JSON.
 * Storage monitoring via navigator.storage.estimate().
 */

// --- Export ---

async function exportBackup() {
    const progressBar = document.getElementById('backup-progress');
    const statusMsg = document.getElementById('backup-status');
    if (progressBar) progressBar.style.display = 'block';
    if (statusMsg) statusMsg.textContent = '';

    try {
        if (progressBar) progressBar.querySelector('.storage-bar-fill').style.width = '20%';

        const audits = await getAllAudits();
        if (progressBar) progressBar.querySelector('.storage-bar-fill').style.width = '40%';

        const captures = await getAllCaptures();
        if (progressBar) progressBar.querySelector('.storage-bar-fill').style.width = '70%';

        const backup = {
            format: 'SafetySignageAudit-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            audits: audits,
            captures: captures
        };

        const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
        if (progressBar) progressBar.querySelector('.storage-bar-fill').style.width = '90%';

        const date = new Date().toISOString().slice(0, 10);
        const filename = `signage-audit-backup-${date}.json`;

        // Try Web Share first for mobile, fall back to download
        if (document.getElementById('btn-share-backup')) {
            // Store for share button
            window._lastBackupBlob = blob;
            window._lastBackupFilename = filename;
        }

        downloadBlob(blob, filename);

        if (progressBar) progressBar.querySelector('.storage-bar-fill').style.width = '100%';
        if (statusMsg) {
            statusMsg.textContent = `Exported ${audits.length} audits, ${captures.length} captures.`;
            statusMsg.className = 'backup-status-msg success';
        }
    } catch (err) {
        if (statusMsg) {
            statusMsg.textContent = 'Export failed: ' + err.message;
            statusMsg.className = 'backup-status-msg error';
        }
    } finally {
        setTimeout(() => {
            if (progressBar) progressBar.style.display = 'none';
        }, 1500);
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// --- Share (Web Share API for iOS cloud save) ---

async function shareBackup() {
    const statusMsg = document.getElementById('backup-status');

    try {
        // Generate fresh backup
        const audits = await getAllAudits();
        const captures = await getAllCaptures();
        const backup = {
            format: 'SafetySignageAudit-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            audits: audits,
            captures: captures
        };

        const date = new Date().toISOString().slice(0, 10);
        const filename = `signage-audit-backup-${date}.json`;
        const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
        const file = new File([blob], filename, { type: 'application/json' });

        await navigator.share({
            title: 'Safety Signage Audit Backup',
            text: `Backup: ${audits.length} audits, ${captures.length} captures`,
            files: [file]
        });

        if (statusMsg) {
            statusMsg.textContent = 'Shared successfully.';
            statusMsg.className = 'backup-status-msg success';
        }
    } catch (err) {
        if (err.name === 'AbortError') return; // user cancelled
        if (statusMsg) {
            statusMsg.textContent = 'Share failed: ' + err.message;
            statusMsg.className = 'backup-status-msg error';
        }
    }
}

// --- Import ---

async function importBackup() {
    const fileInput = document.getElementById('backup-file-input');
    const statusMsg = document.getElementById('backup-status');
    const overwrite = document.getElementById('backup-overwrite')?.checked || false;

    if (!fileInput.files || !fileInput.files[0]) {
        if (statusMsg) {
            statusMsg.textContent = 'Please select a backup file first.';
            statusMsg.className = 'backup-status-msg error';
        }
        return;
    }

    try {
        const text = await fileInput.files[0].text();
        const data = JSON.parse(text);

        if (data.format !== 'SafetySignageAudit-backup') {
            throw new Error('Invalid backup file format.');
        }

        const database = await openDB();
        let imported = 0;
        let skipped = 0;

        // Import audits
        if (data.audits && data.audits.length > 0) {
            await new Promise((resolve, reject) => {
                const tx = database.transaction('audits', 'readwrite');
                const store = tx.objectStore('audits');

                let pending = data.audits.length;
                for (const audit of data.audits) {
                    const getReq = store.get(audit.id);
                    getReq.onsuccess = () => {
                        if (getReq.result && !overwrite) {
                            skipped++;
                        } else {
                            store.put(audit);
                            imported++;
                        }
                        if (--pending === 0) { /* wait for tx */ }
                    };
                    getReq.onerror = () => {
                        if (--pending === 0) { /* wait for tx */ }
                    };
                }
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }

        // Import captures
        if (data.captures && data.captures.length > 0) {
            await new Promise((resolve, reject) => {
                const tx = database.transaction('captures', 'readwrite');
                const store = tx.objectStore('captures');

                let pending = data.captures.length;
                for (const capture of data.captures) {
                    const getReq = store.get(capture.id);
                    getReq.onsuccess = () => {
                        if (getReq.result && !overwrite) {
                            skipped++;
                        } else {
                            store.put(capture);
                            imported++;
                        }
                        if (--pending === 0) { /* wait for tx */ }
                    };
                    getReq.onerror = () => {
                        if (--pending === 0) { /* wait for tx */ }
                    };
                }
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }

        if (statusMsg) {
            statusMsg.textContent = `Import complete: ${imported} imported, ${skipped} skipped.`;
            statusMsg.className = 'backup-status-msg success';
        }

        fileInput.value = '';
        refreshBackupStats();

    } catch (err) {
        if (statusMsg) {
            statusMsg.textContent = 'Import failed: ' + err.message;
            statusMsg.className = 'backup-status-msg error';
        }
    }
}

// --- Storage Stats ---

async function refreshBackupStats() {
    const countsEl = document.getElementById('backup-counts');
    const barFill = document.getElementById('storage-bar-fill');
    const barLabel = document.getElementById('storage-bar-label');

    if (!countsEl) return;

    try {
        const audits = await getAllAudits();
        const captures = await getAllCaptures();
        countsEl.textContent = `${audits.length} audits, ${captures.length} captures stored`;

        if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            const usedMB = (est.usage / (1024 * 1024)).toFixed(1);
            const quotaMB = (est.quota / (1024 * 1024)).toFixed(0);
            const pct = Math.min((est.usage / est.quota) * 100, 100);

            if (barFill) {
                barFill.style.width = pct + '%';
                // Colour based on usage
                if (pct > 80) {
                    barFill.className = 'storage-bar-fill storage-high';
                } else if (pct > 50) {
                    barFill.className = 'storage-bar-fill storage-medium';
                } else {
                    barFill.className = 'storage-bar-fill storage-low';
                }
            }
            if (barLabel) {
                barLabel.textContent = `${usedMB} MB of ${quotaMB} MB used`;
            }
        } else {
            if (barLabel) barLabel.textContent = 'Storage estimate not available';
        }
    } catch (err) {
        if (countsEl) countsEl.textContent = 'Could not read stats.';
    }

    // Show/hide share button based on Web Share API support
    const shareBtn = document.getElementById('btn-share-backup');
    if (shareBtn) {
        const canShare = navigator.share && navigator.canShare &&
            navigator.canShare({ files: [new File([''], 'test.json', { type: 'application/json' })] });
        shareBtn.style.display = canShare ? 'inline-block' : 'none';
    }
}

// --- Wire up UI events ---

document.addEventListener('DOMContentLoaded', () => {
    const exportBtn = document.getElementById('btn-export-backup');
    if (exportBtn) exportBtn.addEventListener('click', exportBackup);

    const shareBtn = document.getElementById('btn-share-backup');
    if (shareBtn) shareBtn.addEventListener('click', shareBackup);

    const importBtn = document.getElementById('btn-import-backup');
    if (importBtn) importBtn.addEventListener('click', importBackup);
});
