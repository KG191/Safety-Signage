# Email Configuration — Safety Signage Audit

## Overview

The app sends transactional emails for:
- **Sign-up confirmation** — verify email address after account creation
- **Password reset** — link to set a new password

Emails are sent via Supabase Authentication, which can use either its built-in email service or a custom SMTP provider.

## Current Setup

| Setting | Value |
|---------|-------|
| **SMTP Provider** | Resend (resend.com) |
| **Host** | `smtp.resend.com` |
| **Port** | `465` |
| **Username** | `resend` |
| **Password** | Resend API key (stored in Supabase SMTP Settings) |
| **Sender email** | `onboarding@resend.dev` (testing) |
| **Sender name** | Safety Signage Audit |
| **Confirm email** | Enabled in Authentication > Providers > Email |

## Why Custom SMTP?

Supabase's built-in email service has a hard rate limit on the free tier: ~4 emails/hour across all users globally. This blocks real users from signing up. A custom SMTP provider removes this limit entirely.

## Resend Free Tier Limits

- 3,000 emails/month
- 100 emails/day
- No credit card required
- At current pricing ($149 one-off licence), this supports ~100 sign-ups per day — well beyond initial launch needs

## Email Templates

Supabase manages email templates. To customise them:

1. Go to **Supabase > Authentication > Email Templates**
2. Available templates:
   - **Confirm signup** — sent when a user signs up
   - **Magic link** — not used (email/password auth only)
   - **Change email** — sent when user changes their email
   - **Reset password** — sent when user taps "Forgot password?"

Templates support HTML and the following variables:
- `{{ .ConfirmationURL }}` — the verification/reset link
- `{{ .Email }}` — the user's email address
- `{{ .SiteURL }}` — the configured Site URL

## Confirmation Email Flow

1. User signs up in the app (Settings > Account & Licence)
2. Supabase sends confirmation email via Resend SMTP
3. User taps the confirmation link in the email
4. Supabase verifies the token and redirects to `https://symbio-tek.com/confirm.html`
5. `confirm.html` shows "Email Confirmed" and auto-redirects to the app after 3 seconds
6. User signs in with their email and password

### Redirect Configuration

| Setting | Value | Location |
|---------|-------|----------|
| **Site URL** | `https://symbio-tek.com/confirm.html` | Authentication > URL Configuration |
| **Redirect URLs** | `https://symbio-tek.com/confirm.html` | Authentication > URL Configuration |

The redirect goes via `symbio-tek.com` because Supabase email confirmation redirects fail on GitHub Pages subpath URLs (`kg191.github.io/Safety-Signage/`). The `confirm.html` page on `symbio-tek.com` is a lightweight static page that shows a success message and redirects to the app.

## Password Reset Flow

1. User enters their email and taps "Forgot password?" in the app
2. Supabase sends a password reset email via Resend SMTP
3. User taps the reset link in the email
4. Supabase processes the token and redirects to the app with `?reset=true`
5. The app detects the reset parameter and shows a "Set New Password" form
6. User enters a new password and is signed in

### Reset Redirect Configuration

The password reset redirect URL is set in the client code (`js/license.js`):
```
redirectTo: 'https://kg191.github.io/Safety-Signage/index.html?reset=true'
```

This URL must be listed in the **Redirect URLs** in Supabase (Authentication > URL Configuration):
- `https://kg191.github.io/Safety-Signage/index.html`

## Production Checklist

- [ ] Register a custom sending domain in Resend (e.g. `mysafesigns.com.au` or `symbio-tek.com`)
- [ ] Add DNS records (MX, SPF, DKIM) provided by Resend to the domain
- [ ] Update Sender email in Supabase SMTP Settings to `noreply@yourdomain.com`
- [ ] Customise email templates in Supabase with your branding
- [ ] Test sign-up and password reset flows end-to-end
- [ ] Ensure "Confirm email" is enabled in Authentication > Providers > Email

## Scaling Beyond Resend Free Tier

If you exceed 3,000 emails/month (roughly 100 sign-ups/day):
- **Resend Pro**: $20/month for 50,000 emails/month
- **SendGrid**: 100 emails/day free, paid plans from $20/month
- **Amazon SES**: ~$0.10 per 1,000 emails (cheapest at scale)

At the current licence model ($149 one-off), 3,000 sign-ups/month = $447,000 revenue. The SMTP cost is negligible.
