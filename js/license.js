/**
 * License management — Supabase auth, license validation, paywall gating.
 *
 * Free tier: 3 audits without an account.
 * Paid: $149 AUD one-off lifetime license via Stripe Checkout.
 * Offline: license cached in localStorage for 7 days.
 */

// ── Configuration ──────────────────────────────────────────────────
// Replace these with your actual Supabase project values
const SUPABASE_URL = 'https://auacwdtbncawmpjqcnal.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1YWN3ZHRibmNhd21wanFjbmFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjQzMTIsImV4cCI6MjA5MDI0MDMxMn0.cqrpLHF8nyS6rfI_9UuUoRG6XcVZFkR4I2v4lJH-8Fw';
const FREE_AUDIT_LIMIT = 3;
const LICENSE_CACHE_KEY = 'license_cache';
const LICENSE_CACHE_DAYS = 7;

let supabaseClient = null;

function getSupabase() {
    if (!supabaseClient && typeof supabase !== 'undefined') {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

// ── License Status ─────────────────────────────────────────────────

/**
 * Returns { status: 'free'|'trial_expired'|'licensed', auditCount }
 */
async function getLicenseStatus() {
    const audits = await getAllAudits();
    const auditCount = audits.length;

    if (auditCount < FREE_AUDIT_LIMIT) {
        return { status: 'free', auditCount };
    }

    // Check localStorage cache first (works offline)
    const cache = getLicenseCache();
    if (cache && cache.licensed) {
        return { status: 'licensed', auditCount };
    }

    // Try server validation if online
    const sb = getSupabase();
    if (sb) {
        try {
            const { data: { user } } = await sb.auth.getUser();
            if (user) {
                const { data } = await sb.from('licenses')
                    .select('status')
                    .eq('user_id', user.id)
                    .single();

                if (data && data.status === 'active') {
                    setLicenseCache(true);
                    return { status: 'licensed', auditCount };
                }
            }
        } catch (e) {
            // Offline or network error — if we had a previous valid cache
            // that just expired, be lenient (show banner, don't lock out)
            console.warn('License check failed (offline?):', e.message);
        }
    }

    return { status: 'trial_expired', auditCount };
}

// ── License Cache ──────────────────────────────────────────────────

function getLicenseCache() {
    try {
        const raw = localStorage.getItem(LICENSE_CACHE_KEY);
        if (!raw) return null;
        const cache = JSON.parse(raw);
        if (cache.until && Date.now() < cache.until) return cache;
        // Expired
        localStorage.removeItem(LICENSE_CACHE_KEY);
        return null;
    } catch {
        return null;
    }
}

function setLicenseCache(licensed) {
    const until = Date.now() + LICENSE_CACHE_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(LICENSE_CACHE_KEY, JSON.stringify({ licensed, until }));
}

function clearLicenseCache() {
    localStorage.removeItem(LICENSE_CACHE_KEY);
}

// ── Auth Helpers ───────────────────────────────────────────────────

async function licenseSignUp(email, password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not available');
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    return data;
}

async function licenseSignIn(email, password) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not available');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

async function licenseSignOut() {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    clearLicenseCache();
}

async function getLicenseUser() {
    const sb = getSupabase();
    if (!sb) return null;
    try {
        const { data: { user } } = await sb.auth.getUser();
        return user;
    } catch {
        return null;
    }
}

// ── Checkout ───────────────────────────────────────────────────────

async function startCheckout() {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not available');

    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Please sign in first');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
        },
    });

    const result = await res.json();
    if (result.error) throw new Error(result.error);
    if (result.url) window.location.href = result.url;
}

// ── Paywall UI ─────────────────────────────────────────────────────

function showPaywall() {
    document.getElementById('paywall-modal').style.display = 'flex';
}

function hidePaywall() {
    document.getElementById('paywall-modal').style.display = 'none';
}

/**
 * Check license before creating an audit. Returns true if allowed.
 */
async function checkLicenseForNewAudit() {
    const { status, auditCount } = await getLicenseStatus();

    if (status === 'free' || status === 'licensed') {
        return true;
    }

    // trial_expired — show paywall
    showPaywall();
    return false;
}

// ── Audit Counter UI ───────────────────────────────────────────────

async function updateAuditCounter() {
    const counterEl = document.getElementById('audit-counter');
    if (!counterEl) return;

    const { status, auditCount } = await getLicenseStatus();

    if (status === 'licensed') {
        counterEl.textContent = 'Unlimited';
        counterEl.className = 'audit-counter licensed';
    } else {
        const remaining = Math.max(0, FREE_AUDIT_LIMIT - auditCount);
        counterEl.textContent = `${auditCount} of ${FREE_AUDIT_LIMIT} free audits used`;
        counterEl.className = 'audit-counter' + (remaining === 0 ? ' exhausted' : '');
    }
}

// ── Auth UI in Settings ────────────────────────────────────────────

async function refreshAuthUI() {
    const authSection = document.getElementById('license-auth-section');
    if (!authSection) return;

    const user = await getLicenseUser();
    const { status } = await getLicenseStatus();

    const signedInHTML = `
        <div class="vision-status-row">
            <span>Account:</span>
            <span class="vision-indicator active">${escapeHtml(user?.email || '')}</span>
        </div>
        <div class="vision-status-row">
            <span>License:</span>
            <span class="vision-indicator ${status === 'licensed' ? 'active' : 'inactive'}">
                ${status === 'licensed' ? 'Active (Lifetime)' : 'Not purchased'}
            </span>
        </div>
        ${status !== 'licensed' ? '<button class="btn btn-primary" onclick="startCheckout()">Purchase License — $149 AUD</button>' : ''}
        <button class="btn btn-secondary" onclick="handleSignOut()" style="margin-top:0.5rem;">Sign Out</button>
    `;

    const signedOutHTML = `
        <div class="form-group">
            <label for="license-email">Email</label>
            <input type="email" id="license-email" placeholder="you@example.com">
        </div>
        <div class="form-group">
            <label for="license-password">Password</label>
            <input type="password" id="license-password" placeholder="Min 6 characters">
        </div>
        <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-primary" onclick="handleSignIn()" style="flex:1;">Sign In</button>
            <button class="btn btn-secondary" onclick="handleSignUp()" style="flex:1;">Sign Up</button>
        </div>
        <button class="btn-text" onclick="handleForgotPassword()" style="margin-top:0.5rem;">Forgot password?</button>
        <span id="auth-status-msg" class="vision-status-msg"></span>
    `;

    authSection.innerHTML = user ? signedInHTML : signedOutHTML;

    // Reorder cards: show licence & EULA at top until payment is made
    reorderSettingsCards(status);
}

function reorderSettingsCards(status) {
    const settingsView = document.getElementById('view-settings');
    const licenseCard = document.getElementById('license-card');
    const eulaCard = document.getElementById('eula-card');
    if (!settingsView || !licenseCard || !eulaCard) return;

    if (status === 'licensed') {
        // Licensed: move to bottom (append)
        settingsView.appendChild(licenseCard);
        settingsView.appendChild(eulaCard);
    } else {
        // Not licensed: move to top (before first child)
        const firstChild = settingsView.firstElementChild;
        settingsView.insertBefore(eulaCard, firstChild);
        settingsView.insertBefore(licenseCard, eulaCard);
    }
}

async function handleSignIn() {
    const email = document.getElementById('license-email').value.trim();
    const password = document.getElementById('license-password').value;
    const msgEl = document.getElementById('auth-status-msg');

    if (!email || !password) {
        msgEl.textContent = 'Please enter email and password.';
        msgEl.className = 'vision-status-msg error';
        return;
    }

    try {
        await licenseSignIn(email, password);
        await refreshAuthUI();
        await updateAuditCounter();
    } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = 'vision-status-msg error';
    }
}

async function handleSignUp() {
    const email = document.getElementById('license-email').value.trim();
    const password = document.getElementById('license-password').value;
    const msgEl = document.getElementById('auth-status-msg');

    if (!email || !password) {
        msgEl.textContent = 'Please enter email and password.';
        msgEl.className = 'vision-status-msg error';
        return;
    }

    if (password.length < 6) {
        msgEl.textContent = 'Password must be at least 6 characters.';
        msgEl.className = 'vision-status-msg error';
        return;
    }

    try {
        await licenseSignUp(email, password);
        msgEl.innerHTML = 'Confirmation email sent. Check your inbox (and <strong>spam/junk folder</strong>), then sign in.';
        msgEl.className = 'vision-status-msg success';
    } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = 'vision-status-msg error';
    }
}

async function handleSignOut() {
    await licenseSignOut();
    await refreshAuthUI();
    await updateAuditCounter();
}

async function handleForgotPassword() {
    const email = document.getElementById('license-email').value.trim();
    const msgEl = document.getElementById('auth-status-msg');

    if (!email) {
        msgEl.textContent = 'Enter your email above, then tap "Forgot password?"';
        msgEl.className = 'vision-status-msg error';
        return;
    }

    try {
        const sb = getSupabase();
        if (!sb) throw new Error('Service unavailable');
        const { error } = await sb.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://kg191.github.io/Safety-Signage/index.html?reset=true',
        });
        if (error) throw error;
        msgEl.textContent = 'Password reset email sent. Check your inbox.';
        msgEl.className = 'vision-status-msg success';
    } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = 'vision-status-msg error';
    }
}

// ── Payment Success Handler ────────────────────────────────────────

function handlePaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');

    if (payment === 'success') {
        clearLicenseCache();
        // Clean URL
        history.replaceState(null, '', window.location.pathname);
        // Re-check license after a brief delay (webhook may take a moment)
        setTimeout(async () => {
            const { status } = await getLicenseStatus();
            if (status === 'licensed') {
                showPaymentSuccessToast();
            }
            await updateAuditCounter();
            await refreshAuthUI();
        }, 2000);
    } else if (payment === 'cancelled') {
        history.replaceState(null, '', window.location.pathname);
    }
}

function showPaymentSuccessToast() {
    const toast = document.createElement('div');
    toast.className = 'payment-toast';
    toast.textContent = 'Payment received. Unlimited audits unlocked!';
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 50);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ── Password Reset Handler ─────────────────────────────────────────

function handlePasswordReset() {
    // Supabase sends the user back with a hash fragment containing the access token
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);

    if (params.get('reset') === 'true' || (hash && hash.includes('type=recovery'))) {
        // Clean URL
        history.replaceState(null, '', window.location.pathname);

        // Show password reset modal after a brief delay for Supabase to process the token
        setTimeout(() => {
            switchView('settings');
            showPasswordResetUI();
        }, 500);
    }
}

function showPasswordResetUI() {
    const authSection = document.getElementById('license-auth-section');
    if (!authSection) return;

    authSection.innerHTML = `
        <h3 style="margin-bottom:0.75rem; color: var(--primary);">Set New Password</h3>
        <div class="form-group">
            <label for="reset-new-password">New Password</label>
            <input type="password" id="reset-new-password" placeholder="Min 6 characters">
        </div>
        <button class="btn btn-primary" onclick="handleSetNewPassword()">Update Password</button>
        <span id="auth-status-msg" class="vision-status-msg"></span>
    `;
    window.scrollTo(0, 0);
}

async function handleSetNewPassword() {
    const password = document.getElementById('reset-new-password').value;
    const msgEl = document.getElementById('auth-status-msg');

    if (!password || password.length < 6) {
        msgEl.textContent = 'Password must be at least 6 characters.';
        msgEl.className = 'vision-status-msg error';
        return;
    }

    try {
        const sb = getSupabase();
        if (!sb) throw new Error('Service unavailable');
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        msgEl.textContent = 'Password updated. You are now signed in.';
        msgEl.className = 'vision-status-msg success';
        setTimeout(() => refreshAuthUI(), 2000);
    } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = 'vision-status-msg error';
    }
}

// ── Init ───────────────────────────────────────────────────────────

function initLicense() {
    handlePaymentReturn();
    handlePasswordReset();
    updateAuditCounter();

    // Paywall modal close button
    const closeBtn = document.getElementById('paywall-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', hidePaywall);

    // Paywall sign-in redirect
    const paywallSignIn = document.getElementById('paywall-signin-btn');
    if (paywallSignIn) {
        paywallSignIn.addEventListener('click', () => {
            hidePaywall();
            switchView('settings');
        });
    }

    // Paywall purchase button
    const paywallBuy = document.getElementById('paywall-buy-btn');
    if (paywallBuy) {
        paywallBuy.addEventListener('click', async () => {
            const user = await getLicenseUser();
            if (!user) {
                hidePaywall();
                switchView('settings');
                return;
            }
            startCheckout();
        });
    }
}

// Run when DOM is ready (this script loads after app.js)
initLicense();
