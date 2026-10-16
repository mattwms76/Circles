import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { SignJWT, importPKCS8 } from 'npm:jose@6.1.0';
import { Buffer } from 'node:buffer';
import { Environment, SignedDataVerifier } from 'npm:@apple/app-store-server-library@3.1.0';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const allowedPacks = new Set([
  'com.circles.coins.120',
  'com.circles.coins.700',
  'com.circles.coins.1600',
]);
let appleRootCertificates: Promise<Buffer[]> | null = null;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Sign in required' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const adminKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Invalid session' }, 401);
    const body = await request.json();
    if (body?.action === 'readiness') {
      const platform = String(body.platform ?? '').toLowerCase();
      const requiredSecrets =
        platform === 'ios'
          ? [
              'APPLE_ISSUER_ID',
              'APPLE_KEY_ID',
              'APPLE_BUNDLE_ID',
              'APPLE_APP_ID',
              'APPLE_PRIVATE_KEY',
            ]
          : platform === 'android'
            ? [
                'ANDROID_PACKAGE_NAME',
                'GOOGLE_SERVICE_ACCOUNT_EMAIL',
                'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
              ]
            : [];
      const missingSecrets = requiredSecrets.filter((name) => !Deno.env.get(name));
      const ready = requiredSecrets.length > 0 && missingSecrets.length === 0;
      return json(
        {
          ready,
          platform,
          missingSecrets,
          productIds: [...allowedPacks],
          message: ready
            ? 'Store verification is configured. Confirm all listed coin products are active in the store console.'
            : requiredSecrets.length
              ? `Add these Supabase Edge Function secrets: ${missingSecrets.join(', ')}.`
              : 'Unsupported store platform.',
        },
        200,
      );
    }
    const { purchase } = body;
    const productId = String(purchase?.productId ?? '');
    const transactionId = String(purchase?.transactionId ?? purchase?.id ?? '');
    if (!allowedPacks.has(productId) || !transactionId)
      return json({ error: 'Unknown coin pack or transaction' }, 400);

    let verified = false;
    let ledgerTransactionId = transactionId;
    const store = String(purchase?.store ?? purchase?.platform ?? '').toLowerCase();
    if (
      store.includes('apple') ||
      store.includes('appstore') ||
      store.includes('app_store') ||
      store === 'ios'
    ) {
      verified = await verifyApplePurchase(transactionId, user.id, productId);
    } else {
      const token = String(purchase?.purchaseToken ?? '');
      if (!token) return json({ error: 'Google Play purchase token is missing' }, 400);
      verified = await verifyGooglePurchase(productId, token, user.id);
      ledgerTransactionId = `${productId}:${token}`;
    }
    if (!verified) return json({ error: 'The app store did not verify this purchase' }, 402);

    const admin = createClient(supabaseUrl, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: balance, error: creditError } = await admin.rpc('credit_verified_purchase', {
      p_user_id: user.id,
      p_product_id: productId,
      p_store:
        store.includes('apple') ||
        store.includes('appstore') ||
        store.includes('app_store') ||
        store === 'ios'
          ? 'apple'
          : 'google',
      p_transaction_id: ledgerTransactionId,
      p_environment: 'production',
    });
    if (creditError) throw creditError;
    return json({ verified: true, balance }, 200);
  } catch (error) {
    console.error('verify-coin-purchase', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'Could not verify the purchase. Please try again later.' }, 500);
  }
});

async function verifyApplePurchase(transactionId: string, userId: string, productId: string) {
  const issuerId = Deno.env.get('APPLE_ISSUER_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const bundleId = Deno.env.get('APPLE_BUNDLE_ID');
  const appAppleIdRaw = Deno.env.get('APPLE_APP_ID');
  const privateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  if (!issuerId || !keyId || !bundleId || !appAppleIdRaw || !privateKey)
    throw new Error(
      'Apple App Store Server API credentials are not configured (including APPLE_APP_ID)',
    );
  const appAppleId = Number(appAppleIdRaw);
  if (!Number.isSafeInteger(appAppleId) || appAppleId <= 0)
    throw new Error('APPLE_APP_ID must be the numeric App Store Connect app ID');
  const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256');
  const jwt = await new SignJWT({ bid: bundleId })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt()
    .setAudience('appstoreconnect-v1')
    .setExpirationTime('5m')
    .sign(key);
  const environments = [{ url: 'https://api.storekit.apple.com', value: Environment.PRODUCTION }];
  const roots = await getAppleRootCertificates();
  for (const environment of environments) {
    const response = await fetch(
      `${environment.url}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );
    if (!response.ok) continue;
    const result = await response.json();
    const verifier = new SignedDataVerifier(
      roots,
      true,
      environment.value,
      bundleId,
      environment.value === Environment.PRODUCTION ? appAppleId : undefined,
    );
    const payload = await verifier.verifyAndDecodeTransaction(result.signedTransactionInfo);
    return (
      payload.environment === Environment.PRODUCTION &&
      payload.transactionId === transactionId &&
      payload.productId === productId &&
      payload.bundleId === bundleId &&
      payload.appAccountToken?.toLowerCase() === userId.toLowerCase() &&
      !payload.revocationDate
    );
  }
  return false;
}

async function getAppleRootCertificates(): Promise<Buffer[]> {
  if (!appleRootCertificates) {
    const roots = [
      {
        url: 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer',
        fingerprint: '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179',
      },
      {
        url: 'https://www.apple.com/certificateauthority/AppleRootCA-G2.cer',
        fingerprint: 'c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050',
      },
    ];
    appleRootCertificates = Promise.all(
      roots.map(async ({ url, fingerprint }) => {
        const response = await fetch(url);
        if (!response.ok)
          throw new Error('Could not load Apple’s published transaction signing root certificate');
        const bytes = new Uint8Array(await response.arrayBuffer());
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const actualFingerprint = Array.from(digest, (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        if (actualFingerprint !== fingerprint)
          throw new Error(
            'Apple root certificate fingerprint did not match the trusted certificate',
          );
        return Buffer.from(bytes);
      }),
    );
  }
  return await appleRootCertificates;
}

async function verifyGooglePurchase(productId: string, purchaseToken: string, userId: string) {
  const packageName = Deno.env.get('ANDROID_PACKAGE_NAME');
  const serviceEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  if (!packageName || !serviceEmail || !privateKey)
    throw new Error('Google Play Developer API credentials are not configured');
  const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/androidpublisher' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!tokenResponse.ok) throw new Error('Google Play credentials could not be authorized');
  const { access_token: accessToken } = await tokenResponse.json();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/productsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return false;
  const result = await response.json();
  const lineItem = result.productLineItem?.find(
    (item: { productId: string }) => item.productId === productId,
  );
  return (
    result.purchaseStateContext?.purchaseState === 'PURCHASED' &&
    !result.testPurchaseContext &&
    lineItem?.productId === productId &&
    lineItem?.productOfferDetails?.consumptionState !== 'CONSUMPTION_STATE_CONSUMED' &&
    result.obfuscatedExternalAccountId === userId.replace(/-/g, '')
  );
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers });
}
