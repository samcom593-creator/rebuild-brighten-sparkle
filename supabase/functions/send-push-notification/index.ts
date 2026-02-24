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

// Web Push implementation using Web Crypto API (no npm dependency needed)
async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string
): Promise<boolean> {
  try {
    // Import VAPID keys
    const vapidKeys = {
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
    };

    // For web push, we need to create a JWT and encrypt the payload
    // Using the simplified approach with fetch to the push endpoint
    const jwt = await createVapidJwt(subscription.endpoint, vapidKeys);
    
    // Encrypt payload using the subscription keys
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
      return true;
    }

    // 404 or 410 means subscription expired
    if (response.status === 404 || response.status === 410) {
      console.log(`Subscription expired: ${subscription.endpoint.substring(0, 50)}...`);
      return false;
    }

    const text = await response.text();
    console.error(`Push failed (${response.status}): ${text}`);
    return false;
  } catch (err) {
    console.error("Push send error:", err);
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
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: expiry,
    sub: "mailto:notifications@apex-financial.org",
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import private key
  const privateKeyBytes = base64UrlDecode(keys.privateKey);
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

  // Convert DER signature to raw r|s format for JWT
  const sigBytes = new Uint8Array(signature);
  const signatureB64 = base64UrlEncode(sigBytes);

  return `${unsignedToken}.${signatureB64}`;
}

async function encryptPayload(
  payload: string,
  p256dhKey: string,
  authSecret: string
): Promise<Uint8Array> {
  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  // Import subscriber's public key
  const subscriberPublicKeyBytes = base64UrlDecode(p256dhKey);
  const subscriberKey = await crypto.subtle.importKey(
    "raw",
    subscriberPublicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberKey },
    localKeyPair.privateKey,
    256
  );

  // Get local public key bytes
  const localPublicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey)
  );

  const authSecretBytes = base64UrlDecode(authSecret);

  // HKDF to derive encryption key and nonce
  const ikm = new Uint8Array(sharedSecret);
  
  // PRK = HKDF-Extract(auth_secret, shared_secret)
  const prkKey = await crypto.subtle.importKey("raw", authSecretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, ikm));

  // Create info for key derivation
  const encoder = new TextEncoder();
  const keyInfo = createInfo("aesgcm", subscriberPublicKeyBytes, localPublicKeyBytes);
  const nonceInfo = createInfo("nonce", subscriberPublicKeyBytes, localPublicKeyBytes);

  const contentEncryptionKey = await hkdfExpand(prk, keyInfo, 16);
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  // Encrypt with AES-128-GCM
  const cryptoEncKey = await crypto.subtle.importKey(
    "raw",
    contentEncryptionKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Add padding
  const payloadBytes = encoder.encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 2);
  paddedPayload.set(new Uint8Array([0, 0])); // 2-byte padding length
  paddedPayload.set(payloadBytes, 2);

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      cryptoEncKey,
      paddedPayload
    )
  );

  // Build aes128gcm content coding header
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
      return new Response(
        JSON.stringify({ error: "userId or userIds required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Fetch all subscriptions for target users
    const { data: subscriptions, error: fetchError } = await supabase
      .from("push_subscriptions")
      .select("*")
      .in("user_id", targetUserIds);

    if (fetchError) {
      throw new Error(`Failed to fetch subscriptions: ${fetchError.message}`);
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No subscriptions found" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const payload = JSON.stringify({
      title: title || "Apex Financial",
      body: body || "",
      url: url || "/",
      timestamp: Date.now(),
    });

    let sent = 0;
    const expiredEndpoints: string[] = [];

    for (const sub of subscriptions) {
      const success = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload
      );

      if (success) {
        sent++;
      } else {
        expiredEndpoints.push(sub.endpoint);
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", expiredEndpoints);
      console.log(`Cleaned up ${expiredEndpoints.length} expired subscriptions`);
    }

    console.log(`Push notifications sent: ${sent}/${subscriptions.length}`);

    return new Response(
      JSON.stringify({ success: true, sent, total: subscriptions.length, expired: expiredEndpoints.length }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-push-notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
