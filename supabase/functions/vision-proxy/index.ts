import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const FREE_CAPTURE_LIMIT = 3;

const MODEL_MAP: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const userId = body.userId;
    const requestedModel = body.modelPref || "opus"; // 'sonnet' or 'opus'

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId is required" }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Check if user is grandfathered ($149 licence holder)
    const { data: license } = await supabase
      .from("licenses")
      .select("status")
      .eq("user_id", userId)
      .single();

    const isGrandfathered = license?.status === "active";

    let useModel = requestedModel;

    if (!isGrandfathered) {
      // 2. Check free tier: count total captures (reason = 'free_tier')
      const { count: freeUsed } = await supabase
        .from("credit_transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("reason", "free_tier");

      const freeRemaining = FREE_CAPTURE_LIMIT - (freeUsed || 0);

      if (freeRemaining > 0) {
        // Free tier: use Opus, log as free_tier
        useModel = "opus";

        // Proxy the request first, then log
        const result = await proxyToAnthropic(body, useModel);

        // Log free tier usage
        await supabase.from("credit_transactions").insert({
          user_id: userId,
          model: "opus",
          amount: -1,
          balance_after: freeRemaining - 1,
          reason: "free_tier",
        });

        return new Response(result.body, {
          status: result.status,
          headers: CORS_HEADERS,
        });
      }

      // 3. Check paid credits
      const { data: credits } = await supabase
        .from("credits")
        .select("sonnet_balance, opus_balance")
        .eq("user_id", userId)
        .single();

      const balanceColumn = requestedModel === "opus" ? "opus_balance" : "sonnet_balance";
      const balance = credits?.[balanceColumn] || 0;

      if (balance <= 0) {
        return new Response(
          JSON.stringify({ error: "NO_CREDITS", model: requestedModel }),
          { status: 403, headers: CORS_HEADERS }
        );
      }

      // Atomic decrement: only succeeds if balance > 0
      const { data: updated, error: decrementError } = await supabase
        .rpc("decrement_credit", {
          p_user_id: userId,
          p_model: requestedModel,
        });

      // Fallback if RPC doesn't exist yet: manual decrement
      if (decrementError) {
        const newBalance = balance - 1;
        await supabase
          .from("credits")
          .update({
            [balanceColumn]: newBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        // Log transaction
        await supabase.from("credit_transactions").insert({
          user_id: userId,
          model: requestedModel,
          amount: -1,
          balance_after: newBalance,
          reason: "capture",
        });
      }
    }

    // Proxy the request to Anthropic
    const result = await proxyToAnthropic(body, useModel);

    return new Response(result.body, {
      status: result.status,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    console.error("Vision proxy error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});

async function proxyToAnthropic(
  body: Record<string, unknown>,
  model: string
): Promise<{ status: number; body: string }> {
  const anthropicModel = MODEL_MAP[model] || MODEL_MAP.opus;

  const anthropicBody = {
    model: anthropicModel,
    max_tokens: (body.max_tokens as number) || 1024,
    messages: body.messages,
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(anthropicBody),
  });

  const text = await res.text();
  return { status: res.status, body: text };
}
