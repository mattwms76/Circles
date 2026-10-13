import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, loadSource, native } from './react-fixture.mjs';

test('Coin catalogue failures are handled and can be retried', async (t) => {
  let attempts = 0;
  const fetchProducts = async () => {
    if (++attempts === 1) throw new Error('Store offline');
  };
  const { CoinStore } = loadSource('src/components/CoinStore.tsx', {
    'react-native': native,
    'expo-iap': {
      useIAP: () => ({
        connected: true,
        products: [],
        fetchProducts,
        requestPurchase: async () => {},
        finishTransaction: async () => {},
      }),
    },
    '../theme': { colors: {}, radii: {} },
    '../lib/supabase': { backendReady: false },
    './Primitives': { ActionButton: 'ActionButton' },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CoinStore, { balance: 0, onClose() {}, onBalance() {} }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  const retry = () =>
    renderer.root
      .findAllByType('ActionButton')
      .filter((b) => b.props.label === 'Retry loading coin packs');
  assert.equal(attempts, 1);
  assert.equal(retry().length, 1);
  await act(async () => retry()[0].props.onPress());
  assert.equal(attempts, 2);
  assert.equal(retry().length, 0);
});
