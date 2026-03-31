import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });
const APP_URL = Deno.env.get("APP_URL") || "https://kg191.github.io/Safety-Signage";

// Price map: productKey -> { priceId, model, credits }
// Price IDs are loaded from a single JSON env var for easy management
const PRICE_MAP: Record<string, { model: string; credits: number; priceId: string }> = (() => {
  try {
    const map = JSON.parse(Deno.env.get("STRIPE_PRICE_MAP") || "{}");
    return {
      sonnet_100:  { model: "sonnet", credits: 100,  priceId: map.sonnet_100  || "" },
      sonnet_250:  { model: "sonnet", credits: 250,  priceId: map.sonnet_250  || "" },
      sonnet_500:  { model: "sonnet", credits: 500,  priceId: map.sonnet_500  || "" },
      sonnet_1000: { model: "sonnet", credits: 1000, priceId: map.sonnet_1000 || "" },
      opus_100:    { model: "opus",   credits: 100,  priceId: map.opus_100    || "" },
      opus_250:    { model: "opus",   credits: 250,  priceId: map.opus_250    || "" },
      opus_500:    { model: "opus",   credits: 500,  priceId: map.opus_500    || "" },
      opus_1000:   { model: "opus",   credits: 1000, priceId: map.opus_1000   || "" },
    };
  } catch {
    return {};
  }
})();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { email, userId, productKey } = body;

    if (!email || !userId || !productKey) {
      return new Response(
        JSON.stringify({ error: "email, userId, and productKey are required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const product = PRICE_MAP[productKey];
    if (!product || !product.priceId) {
      return new Response(
        JSON.stringify({ error: `Unknown product: ${productKey}` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: product.priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: userId,
      metadata: {
        user_id: userId,
        product_key: productKey,
        model: product.model,
        credits: String(product.credits),
      },
      success_url: `${APP_URL}/index.html?payment=success`,
      cancel_url: `${APP_URL}/index.html?payment=cancelled`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
