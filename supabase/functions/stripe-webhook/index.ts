import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const body = await req.text();
    const event = JSON.parse(body);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id;

      if (!userId) {
        return new Response("Missing client_reference_id", { status: 400 });
      }

      // Use service_role key to bypass RLS
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

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
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
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
