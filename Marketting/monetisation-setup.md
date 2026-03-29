# Monetisation Setup — Step-by-Step Guide

This document walks through the 6 steps required to activate the payment system for the Safety Signage Audit app.

---

## Step 1: Create a Supabase Project

Supabase provides the authentication (email/password sign-up) and licence storage.

1. Go to [supabase.com](https://supabase.com) and sign in (or create an account).
2. Click **New Project**.
3. Set the project name to `mysafesigns` (or similar).
4. Choose the **region** closest to your users (e.g. `ap-southeast-2` for Sydney).
5. Set a strong **database password** and save it securely.
6. Wait for the project to finish provisioning (~2 minutes).
7. Once ready, go to **Settings > API** and note down:
   - **Project URL** — e.g. `https://abcdefg.supabase.co`
   - **anon public key** — starts with `eyJ...`
   - **service_role secret key** — starts with `eyJ...` (keep this secret, never expose in client code)

### Run the Database Migration

1. In the Supabase dashboard, go to **SQL Editor**.
2. Click **New Query**.
3. Paste the contents of `supabase/migrations/001_create_licenses.sql`.
4. Click **Run**.
5. Verify the table was created: go to **Table Editor** and confirm the `licenses` table exists with columns: `id`, `user_id`, `stripe_checkout_session_id`, `stripe_customer_id`, `status`, `purchased_at`, `amount_aud`.

### Enable Email Auth

1. Go to **Authentication > Providers**.
2. Ensure **Email** provider is enabled (it is by default).
3. Optionally disable "Confirm email" for testing (re-enable for production).

### Configure Custom SMTP (Required Before Launch)

Supabase's built-in email service has a strict rate limit on the free tier (~4 emails/hour across all users). This **will** block real users from signing up in production. You must configure a custom SMTP provider to remove this limit.

**Option A: Resend (Recommended — simplest setup)**

1. Go to [resend.com](https://resend.com) and create a free account (3,000 emails/month free).
2. Add and verify your sending domain (e.g. `mysafesigns.com.au` or `symbio-tek.com`):
   - Go to **Domains > Add Domain**.
   - Add the DNS records Resend provides (MX, SPF, DKIM) to your domain's DNS settings.
   - Wait for verification (usually < 5 minutes).
3. Go to **API Keys > Create API Key** and copy the key.
4. In Supabase, go to **Authentication > SMTP Settings > Enable Custom SMTP**.
5. Fill in:
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: your Resend API key
   - **Sender email**: `noreply@yourdomain.com` (must match the verified domain)
   - **Sender name**: `Safety Signage Audit`
6. Save and test by signing up a new user.

**Option B: SendGrid (100 emails/day free)**

1. Go to [sendgrid.com](https://sendgrid.com) and create a free account.
2. Complete sender verification (single sender or domain authentication).
3. Go to **Settings > API Keys > Create API Key** (Full Access).
4. In Supabase, go to **Authentication > SMTP Settings > Enable Custom SMTP**.
5. Fill in:
   - **Host**: `smtp.sendgrid.net`
   - **Port**: `465`
   - **Username**: `apikey` (literally the word "apikey")
   - **Password**: your SendGrid API key
   - **Sender email**: your verified sender email
   - **Sender name**: `Safety Signage Audit`
6. Save and test.

> Once custom SMTP is configured, re-enable "Confirm email" in **Authentication > Providers > Email**. The rate limit is removed — emails are now sent through your SMTP provider, not Supabase's built-in service.

---

## Step 2: Create a Stripe Account, Sandbox, and Product

Stripe processes the $149 AUD payment. Use a **Sandbox** (isolated test environment) for all development and testing.

### Create a Stripe Account

1. Go to [stripe.com](https://stripe.com) and create an account (or sign in).
2. Complete identity verification for Australia (required for live payments later).

### Create a Sandbox for Testing

Sandboxes are completely isolated test environments — no risk of mixing test data with production, and no need to toggle test mode on/off. See [Stripe Sandboxes docs](https://docs.stripe.com/sandboxes).

1. In the Stripe Dashboard, click the **account picker** (top-left, your account name).
2. Click **Sandboxes**.
3. Click **Create sandbox** and name it e.g. `MySafeSigns Dev`.
4. Open the sandbox — you are now in an isolated test environment.
5. All work in Steps 2–6 should be done **inside the sandbox**.

### Get Sandbox API Keys

1. Inside the sandbox, go to **Developers > API Keys**.
2. Note down:
   - **Publishable key** — starts with `pk_test_...`
   - **Secret key** — click **Create secret key**, choose "Building your own integration", and save the key securely (starts with `sk_test_...`, shown only once)

### Create the Product and Price

1. Inside the sandbox, go to **Product Catalog > Add Product**.
2. Fill in:
   - **Name**: `Safety Signage Audit — Lifetime Licence`
   - **Description**: `One-off payment for unlimited lifetime access to the Safety Signage Audit app (AS 1319-1994).`
   - **Pricing model**: One-off
   - **Price**: `$149.00 AUD`
   - **Tax behaviour**: Inclusive (GST is included in the $149)
3. Save the product.
4. Click into the price and note down the **Price ID** — starts with `price_...`.

> All testing uses sandbox keys. When going live, you switch to your main account's live keys — the sandbox remains untouched.

---

## Step 3: Update the Client Configuration

Update the Supabase connection details in the app code.

1. Open `js/license.js`.
2. Find lines 11–12:
   ```js
   const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
   ```
3. Replace with your actual values from Step 1:
   ```js
   const SUPABASE_URL = 'https://abcdefg.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
   ```
4. Save the file.

---

## Step 4: Deploy the Supabase Edge Functions

Two Edge Functions handle the payment flow: one creates the Stripe checkout session, the other processes the webhook.

### Install the Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# Or via npm
npm install -g supabase
```

### Link to Your Project

```bash
cd /path/to/MySafeSigns_2
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is in the Supabase dashboard URL: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF`.

### Set the Environment Secrets

Use the **sandbox** keys from Step 2 for development and testing.

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...       # Sandbox secret key
supabase secrets set STRIPE_PRICE_ID=price_...           # Sandbox price ID
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...     # Set this after Step 5
supabase secrets set APP_URL=https://app.mysafesigns.com.au
```

> The `STRIPE_WEBHOOK_SECRET` will be generated in Step 5. You can set a placeholder now and update it after.

### Deploy the Functions

```bash
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
```

### Verify Deployment

```bash
supabase functions list
```

You should see both `create-checkout` and `stripe-webhook` listed as deployed.

Note the function URLs — they follow this pattern:
- `https://YOUR_PROJECT.supabase.co/functions/v1/create-checkout`
- `https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook`

---

## Step 5: Register the Stripe Webhook

This tells Stripe to notify your Edge Function when a payment is completed.

> Ensure you are **inside the sandbox** when creating the webhook endpoint.

1. In the Stripe Dashboard (sandbox), go to **Developers > Webhooks**.
2. Click **Add endpoint**.
3. Set the **Endpoint URL** to:
   ```
   https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook
   ```
4. Under **Events to send**, select:
   - `checkout.session.completed`
5. Click **Add endpoint**.
6. On the webhook detail page, click **Reveal** under "Signing secret" and copy the value (starts with `whsec_...`).
7. Update the Supabase secret with the real value:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### Test with Stripe CLI (Optional but Recommended)

For local development, you can forward webhooks to your local machine:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to your local Supabase function
stripe listen --forward-to https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook

# In another terminal, trigger a test event
stripe trigger checkout.session.completed
```

---

## Step 6: End-to-End Testing

Test the complete payment flow using the Stripe sandbox before going live.

### 6a. Test the Free Tier

1. Open the app in a browser (clear localStorage and IndexedDB for a fresh start).
2. Dismiss the cover screen.
3. On first launch, the app should navigate to **Settings** with the EULA card highlighted.
4. Accept the EULA.
5. Navigate to **Dashboard** — the counter should show "0 of 3 free audits used".
6. Create 3 audits — counter updates after each.
7. Attempt to create a 4th audit — the **paywall modal** should appear.
8. Click "Continue viewing existing audits" — modal closes, existing data is accessible.

### 6b. Test Sign-Up and Purchase

1. From the paywall modal, click "Sign In / Create Account" (redirects to Settings).
2. Enter an email and password, click **Sign Up**.
3. Check your email for the confirmation link (or disable email confirmation in Supabase for testing).
4. Sign in with the credentials.
5. The Account card should show your email and "Not purchased" licence status.
6. Click **Purchase Licence**.
7. You should be redirected to Stripe Checkout.
8. Use the test card number: `4242 4242 4242 4242`, any future expiry, any CVC.
9. Complete the payment.
10. You should be redirected back to the app with a green toast: "Payment received. Unlimited audits unlocked!"
11. The Dashboard counter should now show "Unlimited".
12. Create additional audits — no paywall.

### 6c. Test Returning Licensed User

1. Close and reopen the app.
2. The licence should be cached — no sign-in prompt.
3. You should be able to create audits immediately.
4. In Settings, the Account card should show "Active (Lifetime)".

### 6d. Test Offline Behaviour

1. Put the device in airplane mode.
2. If the licence cache is still valid (<7 days), the app should work normally.
3. If on the free tier, the 3-audit limit still works (count is local in IndexedDB).

### 6e. Test Cross-Device

1. Sign in on a second device/browser with the same account.
2. The licence should be fetched from Supabase and work immediately.

### 6f. Verify in Stripe Sandbox

1. Go to **Payments** in the Stripe sandbox — you should see the test payment.
2. Go to **Customers** — the customer should be linked to the email.

### Going Live Checklist

When all sandbox testing passes, switch to your main Stripe account (not the sandbox) for production:

- [ ] In your **main Stripe account** (not sandbox), create the same Product and Price ($149 AUD)
- [ ] Note the live **Price ID**, **Secret key**, and **Publishable key**
- [ ] Create a new webhook endpoint in the main account pointing to your Edge Function URL
- [ ] Update Supabase secrets with live values:
  - `STRIPE_SECRET_KEY` → live secret key (`sk_live_...`)
  - `STRIPE_PRICE_ID` → live price ID
  - `STRIPE_WEBHOOK_SECRET` → live webhook signing secret
- [ ] Update `APP_URL` to the production domain
- [ ] Configure custom SMTP (Resend or SendGrid) in Supabase Authentication > SMTP Settings
- [ ] Re-enable "Confirm email" in Supabase Authentication settings
- [ ] Set `ANTHROPIC_API_KEY` in Supabase secrets with your production Anthropic key
- [ ] Deploy the app to production hosting (e.g. Vercel, Netlify, or your own server)
- [ ] Test one real $149 payment end-to-end, then refund it
- [ ] The sandbox remains available for future development and testing
