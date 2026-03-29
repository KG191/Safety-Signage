import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const FREE_AUDIT_LIMIT = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");

    // Determine user status: anonymous (free tier) or authenticated
    let isLicensed = false;
    let auditCount = 0;

    if (authHeader) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Check licence
        const serviceClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        const { data: license } = await serviceClient
          .from("licenses")
          .select("status")
          .eq("user_id", user.id)
          .single();

        isLicensed = license?.status === "active";
      }
    }

    // Parse request body to get audit count from client
    const body = await req.json();
    auditCount = body.auditCount || 0;

    // Gate: allow free users (< 3 audits) and licensed users
    if (!isLicensed && auditCount >= FREE_AUDIT_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Trial expired. Purchase a licence for unlimited access." }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Proxy the request to Anthropic
    const anthropicBody = {
      model: body.model || "claude-haiku-4-5-20251001",
      max_tokens: body.max_tokens || 1024,
      messages: body.messages,
    };

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(anthropicBody),
    });

    const result = await anthropicRes.text();

    return new Response(result, {
      status: anthropicRes.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
