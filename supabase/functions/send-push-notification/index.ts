import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string
): Promise<boolean> {
  try {
    const vapidKeys = {
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
    };

    console.log(`[Push] Attempting push to endpoint: ${subscription.endpoint.substring(0, 60)}...`);

    const jwt = await createVapidJwt(subscription.endpoint, vapidKeys);
    
    const encrypted = await encryptPayload(
      payload,
      subscription.p256dh,
      subscription.auth
    );

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Authorization": `vapid t=${jwt}, k=${vapidKeys.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
      },
      body: encrypted,
    });

    if (response.status === 201 || response.status === 200) {
      console.log(`[Push] Success (${response.status})`);
      return true;
    }

    if (response.status === 404 || response.status === 410) {
      console.log(`[Push] Subscription expired (${response.status}): ${subscription.endpoint.substring(0, 50)}...`);
      return false;
    }

    const text = await response.text();
    console.error(`[Push] Failed (${response.status}): ${text}`);
    return false;
  } catch (err: any) {
    console.error(`[Push] Send error: ${err.message}`, err.stack || "");
    return false;
  }
}

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

async function createVapidJwt(
  endpoint: string,
  keys: { publicKey: string; privateKey: string }
): Promise<string> {
  try {
    const url = new URL(endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

    const header = { typ: "JWT", alg: "ES256" };
    const payload = {
      aud: audience,
      exp: expiry,
      sub: "mailto:notifications@apex-financial.org",
    };

    const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    const privateKeyBytes = base64UrlDecode(keys.privateKey);
    console.log(`[Push] VAPID private key length: ${privateKeyBytes.length} bytes`);
    
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      new TextEncoder().encode(unsignedToken)
    );

    const sigBytes = new Uint8Array(signature);
    const signatureB64 = base64UrlEncode(sigBytes);

    return `${unsignedToken}.${signatureB64}`;
  } catch (err: any) {
    console.error(`[Push] VAPID JWT creation failed: ${err.message}`, err.stack || "");
    throw err;
  }
}

async function encryptPayload(
  payload: string,
  p256dhKey: string,
  authSecret: string
): Promise<Uint8Array> {
  try {
    const localKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );

    const subscriberPublicKeyBytes = base64UrlDecode(p256dhKey);
    const subscriberKey = await crypto.subtle.importKey(
      "raw",
      subscriberPublicKeyBytes,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );

    const sharedSecret = await crypto.subtle.deriveBits(
      { name: "ECDH", public: subscriberKey },
      localKeyPair.privateKey,
      256
    );

    const localPublicKeyBytes = new Uint8Array(
      await crypto.subtle.exportKey("raw", localKeyPair.publicKey)
    );

    const authSecretBytes = base64UrlDecode(authSecret);

    const ikm = new Uint8Array(sharedSecret);
    
    const prkKey = await crypto.subtle.importKey("raw", authSecretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const prk = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, ikm));

    const keyInfo = createInfo("aesgcm", subscriberPublicKeyBytes, localPublicKeyBytes);
    const nonceInfo = createInfo("nonce", subscriberPublicKeyBytes, localPublicKeyBytes);

    const contentEncryptionKey = await hkdfExpand(prk, keyInfo, 16);
    const nonce = await hkdfExpand(prk, nonceInfo, 12);

    const cryptoEncKey = await crypto.subtle.importKey(
      "raw",
      contentEncryptionKey,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(payload);
    const paddedPayload = new Uint8Array(payloadBytes.length + 2);
    paddedPayload.set(new Uint8Array([0, 0]));
    paddedPayload.set(payloadBytes, 2);

    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce },
        cryptoEncKey,
        paddedPayload
      )
    );

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const recordSize = new Uint8Array(4);
    new DataView(recordSize.buffer).setUint32(0, encrypted.length + 1);
    
    const header = new Uint8Array(16 + 4 + 1 + localPublicKeyBytes.length);
    header.set(salt);
    header.set(recordSize, 16);
    header[20] = localPublicKeyBytes.length;
    header.set(localPublicKeyBytes, 21);

    const result = new Uint8Array(header.length + encrypted.length);
    result.set(header);
    result.set(encrypted, header.length);

    return result;
  } catch (err: any) {
    console.error(`[Push] Payload encryption failed: ${err.message}`, err.stack || "");
    throw err;
  }
}

function createInfo(type: string, clientPublicKey: Uint8Array, serverPublicKey: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(`Content-Encoding: ${type}\0`);
  const p256dhBytes = encoder.encode("P-256\0");
  
  const info = new Uint8Array(
    typeBytes.length + p256dhBytes.length + 2 + clientPublicKey.length + 2 + serverPublicKey.length
  );
  
  let offset = 0;
  info.set(typeBytes, offset); offset += typeBytes.length;
  info.set(p256dhBytes, offset); offset += p256dhBytes.length;
  info[offset++] = 0; info[offset++] = clientPublicKey.length;
  info.set(clientPublicKey, offset); offset += clientPublicKey.length;
  info[offset++] = 0; info[offset++] = serverPublicKey.length;
  info.set(serverPublicKey, offset);
  
  return info;
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const input = new Uint8Array(info.length + 1);
  input.set(info);
  input[info.length] = 1;
  const result = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
  return result.slice(0, length);
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, userIds, title, body, url } = await req.json();

    const targetUserIds = userIds || (userId ? [userId] : []);
    if (targetUserIds.length === 0) {
      console.error("[Push] No userId or userIds provided");
      return new Response(
        JSON.stringify({ error: "userId or userIds required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`[Push] Sending to ${targetUserIds.length} user(s): ${targetUserIds.join(", ")}`);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: subscriptions, error: fetchError } = await supabase
      .from("push_subscriptions")
      .select("*")
      .in("user_id", targetUserIds);

    if (fetchError) {
      console.error(`[Push] Failed to fetch subscriptions: ${fetchError.message}`);
      throw new Error(`Failed to fetch subscriptions: ${fetchError.message}`);
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[Push] No subscriptions found for users: ${targetUserIds.join(", ")}`);
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No subscriptions found" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`[Push] Found ${subscriptions.length} subscription(s)`);

    const payload = JSON.stringify({
      title: title || "Apex Financial",
      body: body || "",
      url: url || "/",
      timestamp: Date.now(),
    });

    let sent = 0;
    const expiredEndpoints: string[] = [];
    const failedUserIds: string[] = [];

    for (const sub of subscriptions) {
      const success = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload
      );

      if (success) {
        sent++;
      } else {
        expiredEndpoints.push(sub.endpoint);
        if (sub.user_id) failedUserIds.push(sub.user_id);
      }
    }

    if (expiredEndpoints.length > 0) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", expiredEndpoints);
      console.log(`[Push] Cleaned up ${expiredEndpoints.length} expired subscriptions`);
    }

    // Log push delivery to notification_log for audit trail
    for (const uid of targetUserIds) {
      const userSent = subscriptions.some((s: any) => s.user_id === uid && !expiredEndpoints.includes(s.endpoint));
      try {
        await supabase.from("notification_log").insert({
          recipient_user_id: uid,
          channel: "push",
          title: title || "Push Notification",
          message: body || "",
          status: userSent ? "sent" : "failed",
          error_message: userSent ? null : "Push delivery failed or subscription expired",
          metadata: { trigger: "send-push-notification", url },
        });
      } catch (e) {
        console.error(`[Push] Log write failed for ${uid}:`, e);
      }
    }

    console.log(`[Push] Results: ${sent}/${subscriptions.length} sent successfully`);

    return new Response(
      JSON.stringify({ success: true, sent, total: subscriptions.length, expired: expiredEndpoints.length, failedUserIds }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error(`[Push] Error: ${error.message}`, error.stack || "");
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
