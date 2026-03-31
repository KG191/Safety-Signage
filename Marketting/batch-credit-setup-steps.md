# Batch Credit System — Setup Steps

**Status:** Code deployed, these 3 steps needed before testing.

## Step 1: Run Database Migration

1. Go to **Supabase Dashboard > SQL Editor**
2. Click **New Query**
3. Paste the contents of `supabase/migrations/002_create_credits.sql`
4. Click **Run**
5. Verify: go to **Table Editor** and confirm `credits` and `credit_transactions` tables exist

## Step 2: Create 8 Stripe Products in Sandbox

In the **Stripe Sandbox** (MySafeSigns Dev), go to **Product Catalog > Add Product** and create these 8 products:

### Sonnet Products
| Product Name | Price (AUD) | Type |
|-------------|-------------|------|
| Sonnet 100 Credits | $49.00 | One-off |
| Sonnet 250 Credits | $99.00 | One-off |
| Sonnet 500 Credits | $149.00 | One-off |
| Sonnet 1000 Credits | $249.00 | One-off |

### Opus Products
| Product Name | Price (AUD) | Type |
|-------------|-------------|------|
| Opus 100 Credits | $79.00 | One-off |
| Opus 250 Credits | $169.00 | One-off |
| Opus 500 Credits | $299.00 | One-off |
| Opus 1000 Credits | $499.00 | One-off |

After creating each product, note down its **Price ID** (starts with `price_...`).

## Step 3: Set the Price Map Environment Variable

Run this in your Terminal, replacing each `price_xxx` with the actual Price IDs from Step 2:

```bash
supabase secrets set STRIPE_PRICE_MAP='{"sonnet_100":"price_xxx","sonnet_250":"price_xxx","sonnet_500":"price_xxx","sonnet_1000":"price_xxx","opus_100":"price_xxx","opus_250":"price_xxx","opus_500":"price_xxx","opus_1000":"price_xxx"}'
```

Then redeploy the checkout function to pick up the new secret:

```bash
supabase functions deploy create-checkout --no-verify-jwt
```

## After Setup: Test

1. Clear Safari data for the site
2. Open the app, sign in
3. Go to **Pricing** tab — verify both columns show
4. Select a batch (e.g. Sonnet 100), tap **Buy Sonnet Credits**
5. Complete Stripe Checkout with test card `4242 4242 4242 4242`
6. Return to app — Dashboard should show "Credits: Sonnet 100 | Opus 0"
7. Take a photo — credit should deduct to 99
