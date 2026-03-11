/**
 * IndexedDB wrapper for offline-first audit data storage.
 *
 * Database: SafetySignageAuditDB
 * Stores:
 *   - audits: audit session metadata (site, auditor, date)
 *   - captures: individual sign records with photos, GPS, compliance data
 */

const DB_NAME = 'SafetySignageAuditDB';
const DB_VERSION = 2;

let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            const oldVersion = event.oldVersion;

            if (!database.objectStoreNames.contains('audits')) {
                const auditStore = database.createObjectStore('audits', { keyPath: 'id' });
                auditStore.createIndex('date', 'date', { unique: false });
            }

            if (!database.objectStoreNames.contains('captures')) {
                const captureStore = database.createObjectStore('captures', { keyPath: 'id' });
                captureStore.createIndex('auditId', 'auditId', { unique: false });
                captureStore.createIndex('category', 'category', { unique: false });
                captureStore.createIndex('overall', 'overall', { unique: false });
            }

            // v2: Add detectionConfidence index for querying by AI confidence
            if (oldVersion < 2) {
                if (database.objectStoreNames.contains('captures')) {
                    const captureStore = event.target.transaction.objectStore('captures');
                    if (!captureStore.indexNames.contains('detectionConfidence')) {
                        captureStore.createIndex('detectionConfidence', 'detection.confidence', { unique: false });
                    }
                }
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// --- Audit CRUD ---

async function createAudit(auditData) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('audits', 'readwrite');
        const store = tx.objectStore('audits');
        const audit = {
            id: generateId(),
            ...auditData,
            createdAt: new Date().toISOString()
        };
        const request = store.add(audit);
        request.onsuccess = () => resolve(audit);
        request.onerror = () => reject(request.error);
    });
}

async function getAllAudits() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('audits', 'readonly');
        const store = tx.objectStore('audits');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getAudit(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('audits', 'readonly');
        const store = tx.objectStore('audits');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteAudit(id) {
    const database = await openDB();
    // Delete all captures for this audit first
    const captures = await getCapturesByAudit(id);
    const tx = database.transaction(['audits', 'captures'], 'readwrite');
    for (const capture of captures) {
        tx.objectStore('captures').delete(capture.id);
    }
    tx.objectStore('audits').delete(id);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- Capture CRUD ---

async function saveCapture(captureData) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('captures', 'readwrite');
        const store = tx.objectStore('captures');
        const capture = {
            id: generateId(),
            ...captureData,
            capturedAt: new Date().toISOString()
        };
        const request = store.add(capture);
        request.onsuccess = () => resolve(capture);
        request.onerror = () => reject(request.error);
    });
}

async function getCapturesByAudit(auditId) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('captures', 'readonly');
        const store = tx.objectStore('captures');
        const index = store.index('auditId');
        const request = index.getAll(auditId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getAllCaptures() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('captures', 'readonly');
        const store = tx.objectStore('captures');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteCapture(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('captures', 'readwrite');
        const store = tx.objectStore('captures');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}
