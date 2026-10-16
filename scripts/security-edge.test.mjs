import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { loadEdgeFunction } from './edge-fixture.mjs';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'security@example.test' };
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'synthetic',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
  APPLE_APP_ID: '123',
  APPLE_BUNDLE_ID: 'com.circles.social',
  APPLE_ISSUER_ID: 'synthetic',
  APPLE_KEY_ID: 'synthetic',
  APPLE_PRIVATE_KEY: 'synthetic',
  ANDROID_PACKAGE_NAME: 'com.circles.social',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'synthetic',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'synthetic',
};
const request = (body) =>
  new Request('https://security.invalid', {
    method: 'POST',
    headers: { Authorization: 'Bearer synthetic' },
    body: JSON.stringify(body),
  });
test('Deletion rejects absent or incorrect passwords and mismatched identities before any destructive call', async () => {
  for (const mode of ['missing', 'incorrect', 'foreign', 'valid']) {
    const calls = [];
    const client = {
      auth: {
        getUser: async () => ({ data: { user }, error: null }),
        signInWithPassword: async () => ({
          data: {
            user: mode === 'foreign' ? { id: 'different' } : user,
            session: mode === 'incorrect' ? null : { access_token: 'synthetic' },
          },
          error: mode === 'incorrect' ? Error('Invalid password') : null,
        }),
        admin: {
          signOut: async () => {
            calls.push('revoke');
            return { error: null };
          },
          deleteUser: async () => {
            calls.push('delete');
            return { error: null };
          },
        },
      },
      rpc: async () => {
        calls.push('prepare');
        return { error: null };
      },
      storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
    };
    const { handler } = loadEdgeFunction(
      'delete-account',
      { 'npm:@supabase/supabase-js@2.117.3': { createClient: () => client } },
      env,
    );
    const r = await handler(
      request({
        confirmation: 'DELETE',
        ...(mode === 'missing' ? {} : { password: 'synthetic-password' }),
      }),
    );
    assert.equal(r.status, mode === 'valid' ? 200 : mode === 'missing' ? 400 : 403);
    assert.deepEqual(calls, mode === 'valid' ? ['revoke', 'prepare', 'delete'] : []);
  }
});
class JWT {
  setProtectedHeader() {
    return this;
  }
  setIssuer() {
    return this;
  }
  setIssuedAt() {
    return this;
  }
  setAudience() {
    return this;
  }
  setExpirationTime() {
    return this;
  }
  async sign() {
    return 'synthetic';
  }
}
test('Apple production verification never falls back to sandbox and never credits mismatched, sandbox or revoked receipts', async () => {
  for (const mode of ['production', 'sandbox', 'missing', 'foreign', 'revoked']) {
    const calls = [],
      urls = [];
    const { handler, sandbox } = loadEdgeFunction(
      'verify-coin-purchase',
      {
        'npm:@supabase/supabase-js@2.117.3': {
          createClient: () => ({
            auth: { getUser: async () => ({ data: { user }, error: null }) },
            rpc: async (name, args) => {
              calls.push({ name, args });
              return { data: 120, error: null };
            },
          }),
        },
        'npm:jose@6.1.0': { SignJWT: JWT, importPKCS8: async () => ({}) },
        'npm:@apple/app-store-server-library@3.1.0': {
          Environment: { PRODUCTION: 'Production', SANDBOX: 'Sandbox' },
          SignedDataVerifier: class {
            async verifyAndDecodeTransaction() {
              return {
                environment: mode === 'sandbox' ? 'Sandbox' : 'Production',
                transactionId: 'receipt',
                productId: 'com.circles.coins.120',
                bundleId: 'com.circles.social',
                appAccountToken: mode === 'foreign' ? 'foreign' : user.id,
                ...(mode === 'revoked' ? { revocationDate: 1 } : {}),
              };
            }
          },
        },
        fetch: async (url) => {
          urls.push(url);
          return Response.json(
            { signedTransactionInfo: 'synthetic' },
            { status: mode === 'missing' ? 404 : 200 },
          );
        },
      },
      env,
    );
    vm.runInContext('getAppleRootCertificates=async()=>[]', sandbox);
    const r = await handler(
      request({
        purchase: { productId: 'com.circles.coins.120', transactionId: 'receipt', store: 'ios' },
      }),
    );
    assert.equal(r.status, mode === 'production' ? 200 : 402);
    assert.equal(calls.length, mode === 'production' ? 1 : 0);
    assert.ok(urls.every((url) => !url.includes('sandbox')));
    if (calls.length) {
      assert.equal(calls[0].name, 'credit_verified_purchase');
      assert.equal(calls[0].args.p_environment, 'production');
      assert.equal(calls[0].args.p_store, 'apple');
    }
  }
});
test('Google test purchases cannot reach wallet credit', async () => {
  for (const isTest of [true, false]) {
    let credits = 0;
    const { handler } = loadEdgeFunction(
      'verify-coin-purchase',
      {
        'npm:@supabase/supabase-js@2.117.3': {
          createClient: () => ({
            auth: { getUser: async () => ({ data: { user }, error: null }) },
            rpc: async () => {
              credits++;
              return { data: 120, error: null };
            },
          }),
        },
        'npm:jose@6.1.0': { SignJWT: JWT, importPKCS8: async () => ({}) },
        'npm:@apple/app-store-server-library@3.1.0': {},
        fetch: async (url) =>
          Response.json(
            url.includes('oauth2.googleapis.com')
              ? { access_token: 'synthetic' }
              : {
                  purchaseStateContext: { purchaseState: 'PURCHASED' },
                  productLineItem: [
                    {
                      productId: 'com.circles.coins.120',
                      productOfferDetails: {
                        consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED',
                      },
                    },
                  ],
                  obfuscatedExternalAccountId: user.id.replaceAll('-', ''),
                  ...(isTest ? { testPurchaseContext: { fopType: 'TEST' } } : {}),
                },
          ),
      },
      env,
    );
    const r = await handler(
      request({
        purchase: {
          productId: 'com.circles.coins.120',
          transactionId: 'receipt',
          store: 'android',
          purchaseToken: 'synthetic',
        },
      }),
    );
    assert.equal(r.status, isTest ? 402 : 200);
    assert.equal(credits, isTest ? 0 : 1);
  }
});
