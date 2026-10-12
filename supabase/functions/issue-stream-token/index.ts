import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { RtcRole, RtcTokenBuilder } from "npm:agora-token@2.0.7";

const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Sign in required" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const body = await request.json();
    const sessionId = String(body.sessionId ?? "");
    const requestedRole = body.role as "host" | "cohost" | "viewer";
    if (!sessionId || !["host", "cohost", "viewer"].includes(requestedRole)) return json({ error: "Invalid stream request" }, 400);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: session, error: sessionError } = await admin.from("live_sessions").select("id,host_id,circle_id,status,host_heartbeat_at").eq("id", sessionId).maybeSingle();
    if (sessionError) return json({ error: "Could not verify live room access" }, 500);
    if (!session || session.status !== "live" || Date.now() - Date.parse(session.host_heartbeat_at) > 60_000) return json({ error: "Live room has ended" }, 404);
    const { data: block, error: blockError } = await admin.from("blocks").select("blocker_id")
      .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${session.host_id}),and(blocker_id.eq.${session.host_id},blocked_id.eq.${user.id})`).limit(1).maybeSingle();
    if (blockError) return json({ error: "Could not verify live room access" }, 500);
    if (block) return json({ error: "Live room access is unavailable" }, 403);
    if (requestedRole === "host" && session.host_id !== user.id) return json({ error: "Only the host can publish as host" }, 403);
    if (requestedRole === "cohost") {
      const { data: seat } = await admin.from("live_seats").select("role").eq("session_id", sessionId).eq("user_id", user.id).maybeSingle();
      if (seat?.role !== "cohost") return json({ error: "Your co-host request has not been accepted" }, 403);
    }
    if (requestedRole !== "host" && session.circle_id) {
      const { data: circle, error: circleError } = await admin.from("circles").select("is_private").eq("id", session.circle_id).maybeSingle();
      if (circleError || !circle) return json({ error: "Could not verify live room access" }, 500);
      if (circle?.is_private) {
        const { data: member, error: memberError } = await admin.from("circle_memberships").select("status").eq("circle_id", session.circle_id).eq("user_id", user.id).maybeSingle();
        if (memberError) return json({ error: "Could not verify live room access" }, 500);
        if (member?.status !== "member") return json({ error: "Join this private circle to access its live room" }, 403);
      }
    }

    const appId = Deno.env.get("AGORA_APP_ID");
    const certificate = Deno.env.get("AGORA_APP_CERTIFICATE");
    if (!appId || !certificate) return json({ error: "Agora server credentials are not configured" }, 503);
    const uid = Number.parseInt(user.id.replace(/-/g, "").slice(0, 7), 16) + 1;
    // AccessToken2 expects durations from now, in seconds (not Unix timestamps).
    const tokenLifetimeSeconds = 5 * 60;
    const agoraRole = requestedRole === "viewer" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
    const token = RtcTokenBuilder.buildTokenWithUid(appId, certificate, sessionId, uid, agoraRole, tokenLifetimeSeconds, tokenLifetimeSeconds);
    return json({ token, channel: sessionId, uid, role: requestedRole }, 200);
  } catch (error) {
    console.error("issue-stream-token", error);
    return json({ error: "Could not create a stream token" }, 500);
  }
});

function json(body: unknown, status: number) { return new Response(JSON.stringify(body), { status, headers }); }
