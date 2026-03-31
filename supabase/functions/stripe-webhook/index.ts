import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const body = await req.text();
    const event = JSON.parse(body);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id;
      const metadata = session.metadata || {};

      if (!userId) {
        return new Response("Missing client_reference_id", { status: 400 });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const model = metadata.model; // 'sonnet' or 'opus'
      const credits = parseInt(metadata.credits || "0", 10);
      const productKey = metadata.product_key;

      if (model && credits > 0) {
        // Credit-based purchase — add credits to user's balance
        const balanceColumn = model === "opus" ? "opus_balance" : "sonnet_balance";

        // Upsert credits row — increment the appropriate balance
        const { data: existing } = await supabase
          .from("credits")
          .select("sonnet_balance, opus_balance")
          .eq("user_id", userId)
          .single();

        if (existing) {
          const newBalance = (existing[balanceColumn] || 0) + credits;
          const { error } = await supabase
            .from("credits")
            .update({
              [balanceColumn]: newBalance,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);

          if (error) {
            console.error("Credit update error:", error);
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
          }

          // Log transaction
          await supabase.from("credit_transactions").insert({
            user_id: userId,
            model: model,
            amount: credits,
            balance_after: newBalance,
            reason: `purchase:${credits}`,
            stripe_session_id: session.id,
          });
        } else {
          // First purchase — insert new credits row
          const newRow: Record<string, unknown> = {
            user_id: userId,
            sonnet_balance: model === "sonnet" ? credits : 0,
            opus_balance: model === "opus" ? credits : 0,
            updated_at: new Date().toISOString(),
          };

          const { error } = await supabase.from("credits").insert(newRow);

          if (error) {
            console.error("Credit insert error:", error);
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
          }

          // Log transaction
          await supabase.from("credit_transactions").insert({
            user_id: userId,
            model: model,
            amount: credits,
            balance_after: credits,
            reason: `purchase:${credits}`,
            stripe_session_id: session.id,
          });
        }
      } else {
        // Legacy $149 licence purchase (grandfathered)
        const { error } = await supabase.from("licenses").upsert({
          user_id: userId,
          stripe_checkout_session_id: session.id,
          stripe_customer_id: session.customer,
          status: "active",
          purchased_at: new Date().toISOString(),
          amount_aud: session.amount_total || 14900,
        }, { onConflict: "user_id" });

        if (error) {
          console.error("License insert error:", error);
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
