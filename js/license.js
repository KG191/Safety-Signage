/**
 * Credit-based licence management — Supabase auth, credit balance, paywall gating.
 *
 * Free tier: 3 captures with Opus (no account needed for local CV, account needed for AI).
 * Paid: Batch credit purchases (Sonnet or Opus) via Stripe Checkout.
 * Grandfathered: $149 lifetime licence holders get unlimited credits.
 * Offline: local CV fallback works without credits.
 */

// ── Configuration ──────────────────────────────────────────────────
// SUPABASE_URL and SUPABASE_ANON_KEY defined in index.html inline script
const FREE_CAPTURE_LIMIT = 3;
const CREDIT_CACHE_KEY = 'credit_cache';
const CREDIT_CACHE_SECONDS = 60; // Short TTL for credit balance cache

let supabaseClient = null;

function getSupabase() {
    if (!supabaseClient && typeof supabase !== 'undefined') {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

// ── Credit Status ──────────────────────────────────────────────────

/**
 * Returns { status, sonnetBalance, opusBalance, captureCount }
 * Status: 'free' | 'has_credits' | 'no_credits' | 'licensed' (grandfathered)
 */
async function getCreditStatus() {
    const captures = await getAllCaptures();
    const captureCount = captures.length;

    // Check cache first
    const cache = getCreditCache();
    if (cache) {
        if (cache.licensed) return { status: 'licensed', sonnetBalance: 999, opusBalance: 999, captureCount };
        if (cache.sonnet > 0 || cache.opus > 0) return { status: 'has_credits', sonnetBalance: cache.sonnet, opusBalance: cache.opus, captureCount };
    }

    // Free tier: check local capture count (works offline)
    if (captureCount < FREE_CAPTURE_LIMIT) {
        return { status: 'free', sonnetBalance: 0, opusBalance: 0, captureCount };
    }

    // Need to check server for credits/licence
    const sb = getSupabase();
    if (!sb) return { status: 'no_credits', sonnetBalance: 0, opusBalance: 0, captureCount };

    try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return { status: 'no_credits', sonnetBalance: 0, opusBalance: 0, captureCount };

        // Check grandfathered licence
        const { data: license } = await sb.from('licenses')
            .select('status')
            .eq('user_id', user.id)
            .single();

        if (license && license.status === 'active') {
            setCreditCache(0, 0, true);
            return { status: 'licensed', sonnetBalance: 999, opusBalance: 999, captureCount };
        }

        // Check credit balance
        const { data: credits } = await sb.from('credits')
            .select('sonnet_balance, opus_balance')
            .eq('user_id', user.id)
            .single();

        const sonnet = credits?.sonnet_balance || 0;
        const opus = credits?.opus_balance || 0;

        setCreditCache(sonnet, opus, false);

        if (sonnet > 0 || opus > 0) {
            return { status: 'has_credits', sonnetBalance: sonnet, opusBalance: opus, captureCount };
        }

        return { status: 'no_credits', sonnetBalance: 0, opusBalance: 0, captureCount };
    } catch (e) {
        console.warn('Credit check failed (offline?):', e.message);
        // If cache just expired, be lenient
        if (cache) {
            return { status: cache.licensed ? 'licensed' : 'has_credits', sonnetBalance: cache.sonnet || 0, opusBalance: cache.opus || 0, captureCount };
        }
        return { status: 'no_credits', sonnetBalance: 0, opusBalance: 0, captureCount };
    }
}

// ── Credit Cache ───────────────────────────────────────────────────

function getCreditCache() {
    try {
        const raw = localStorage.getItem(CREDIT_CACHE_KEY);
        if (!raw) return null;
        const cache = JSON.parse(raw);
        if (cache.until && Date.now() < cache.until) return cache;
        localStorage.removeItem(CREDIT_CACHE_KEY);
        return null;
    } catch {
        return null;
    }
}

function setCreditCache(sonnet, opus, licensed) {
    const until = Date.now() + CREDIT_CACHE_SECONDS * 1000;
    localStorage.setItem(CREDIT_CACHE_KEY, JSON.stringify({ sonnet, opus, licensed, until }));
}

function clearCreditCache() {
    localStorage.removeItem(CREDIT_CACHE_KEY);
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
    clearCreditCache();
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

async function startCheckout(productKey) {
    const user = await getLicenseUser();
    if (!user) throw new Error('Please sign in first.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, userId: user.id, productKey }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        throw new Error(`Checkout failed (${res.status}): ${errText}`);
    }

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
 * Check credits before creating an audit. Returns true if allowed.
 */
async function checkLicenseForNewAudit() {
    // Audits themselves are always free — the gate is on camera/AI usage
    return true;
}

/**
 * Check credits before starting the camera. Returns true if allowed.
 */
async function checkLicenseForCamera() {
    const { status } = await getCreditStatus();

    if (status === 'free' || status === 'has_credits' || status === 'licensed') {
        return true;
    }

    showPaywall();
    return false;
}

// ── Dashboard Counter ──────────────────────────────────────────────

async function updateAuditCounter() {
    const counterEl = document.getElementById('audit-counter');
    if (!counterEl) return;

    const { status, sonnetBalance, opusBalance, captureCount } = await getCreditStatus();

    if (status === 'licensed') {
        counterEl.textContent = 'Unlimited (Lifetime Licence)';
        counterEl.className = 'audit-counter licensed';
    } else if (status === 'has_credits') {
        counterEl.innerHTML = `Credits: <strong>Sonnet ${sonnetBalance}</strong> | <strong>Opus ${opusBalance}</strong>`;
        counterEl.className = 'audit-counter licensed';
    } else if (status === 'free') {
        const remaining = FREE_CAPTURE_LIMIT - captureCount;
        counterEl.textContent = `${captureCount} of ${FREE_CAPTURE_LIMIT} free captures used (Opus)`;
        counterEl.className = 'audit-counter' + (remaining === 0 ? ' exhausted' : '');
    } else {
        counterEl.innerHTML = 'No credits — <a href="#" onclick="switchView(\'pricing\');return false;">Buy more</a>';
        counterEl.className = 'audit-counter exhausted';
    }
}

// ── Auth UI in Settings ────────────────────────────────────────────

async function refreshAuthUI() {
    const authSection = document.getElementById('license-auth-section');
    if (!authSection) return;

    const user = await getLicenseUser();
    const { status, sonnetBalance, opusBalance } = await getCreditStatus();

    const creditDisplay = status === 'licensed'
        ? '<span class="vision-indicator active">Unlimited (Lifetime)</span>'
        : status === 'has_credits'
        ? `<span class="vision-indicator active">Sonnet: ${sonnetBalance} | Opus: ${opusBalance}</span>`
        : '<span class="vision-indicator inactive">No credits</span>';

    const signedInHTML = `
        <div class="vision-status-row">
            <span>Account:</span>
            <span class="vision-indicator active">${escapeHtml(user?.email || '')}</span>
        </div>
        <div class="vision-status-row">
            <span>Credits:</span>
            ${creditDisplay}
        </div>
        ${status !== 'licensed' ? '<button class="btn btn-primary" onclick="switchView(\'pricing\')">Buy Credits</button>' : ''}
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

    // Reorder cards: show licence & EULA at top until user has credits
    reorderSettingsCards(status);
}

function reorderSettingsCards(status) {
    const settingsView = document.getElementById('view-settings');
    const licenseCard = document.getElementById('license-card');
    const eulaCard = document.getElementById('eula-card');
    if (!settingsView || !licenseCard || !eulaCard) return;

    if (status === 'licensed' || status === 'has_credits') {
        settingsView.appendChild(licenseCard);
        settingsView.appendChild(eulaCard);
    } else {
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
        clearCreditCache();
        history.replaceState(null, '', window.location.pathname);
        setTimeout(async () => {
            showPaymentSuccessToast();
            await updateAuditCounter();
            await refreshAuthUI();
            await refreshPricingView();
        }, 2000);
    } else if (payment === 'cancelled') {
        history.replaceState(null, '', window.location.pathname);
    }
}

function showPaymentSuccessToast() {
    const toast = document.createElement('div');
    toast.className = 'payment-toast';
    toast.textContent = 'Credits added to your account!';
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 50);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ── Password Reset Handler ─────────────────────────────────────────

function handlePasswordReset() {
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);

    if (params.get('reset') === 'true' || (hash && hash.includes('type=recovery'))) {
        history.replaceState(null, '', window.location.pathname);
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

// ── Pricing View ───────────────────────────────────────────────────

async function refreshPricingView() {
    // Update balance display
    const balanceCard = document.getElementById('pricing-balance');
    const user = await getLicenseUser();

    if (user) {
        const { status, sonnetBalance, opusBalance } = await getCreditStatus();
        if (status === 'licensed') {
            balanceCard.style.display = 'block';
            document.getElementById('pricing-sonnet-bal').textContent = 'Unlimited';
            document.getElementById('pricing-opus-bal').textContent = 'Unlimited';
        } else if (sonnetBalance > 0 || opusBalance > 0) {
            balanceCard.style.display = 'block';
            document.getElementById('pricing-sonnet-bal').textContent = sonnetBalance;
            document.getElementById('pricing-opus-bal').textContent = opusBalance;
        } else {
            balanceCard.style.display = 'none';
        }
    } else {
        balanceCard.style.display = 'none';
    }

    // Wire up buy buttons
    document.querySelectorAll('.pricing-buy-btn').forEach(btn => {
        btn.onclick = async () => {
            const model = btn.dataset.model;
            const selectedRadio = document.querySelector(`input[name="${model}-batch"]:checked`);
            if (!selectedRadio) return;

            const productKey = selectedRadio.value;
            const user = await getLicenseUser();

            if (!user) {
                switchView('settings');
                return;
            }

            try {
                btn.disabled = true;
                btn.textContent = 'Redirecting to checkout...';
                await startCheckout(productKey);
            } catch (err) {
                alert('Checkout error: ' + err.message);
                btn.disabled = false;
                btn.textContent = `Buy ${model.charAt(0).toUpperCase() + model.slice(1)} Credits`;
            }
        };
    });
}

// ── Init ───────────────────────────────────────────────────────────

function initLicense() {
    handlePaymentReturn();
    handlePasswordReset();
    updateAuditCounter();

    // Paywall modal buttons
    const closeBtn = document.getElementById('paywall-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', hidePaywall);

    const paywallSignIn = document.getElementById('paywall-signin-btn');
    if (paywallSignIn) {
        paywallSignIn.addEventListener('click', () => {
            hidePaywall();
            switchView('settings');
        });
    }

    // Paywall "View Pricing" button
    const paywallPricing = document.getElementById('paywall-pricing-btn');
    if (paywallPricing) {
        paywallPricing.addEventListener('click', () => {
            hidePaywall();
            switchView('pricing');
        });
    }
}

// Run when DOM is ready (this script loads after app.js)
initLicense();
