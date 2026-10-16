import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useIAP, type Purchase } from 'expo-iap';
import { createThemedStyles, colors, radii } from '../theme';
import { backendReady, requireSupabase } from '../lib/supabase';
import { Sheet } from './Sheet';
import { ActionButton } from './Primitives';

const packs = [
  {
    sku: 'com.circles.coins.120',
    coins: 120,
    title: 'A little love',
    price: '$0.99',
    tint: 'sage' as const,
  },
  {
    sku: 'com.circles.coins.700',
    coins: 700,
    title: 'A lovely bunch',
    price: '$4.99',
    tint: 'lilac' as const,
  },
  {
    sku: 'com.circles.coins.1600',
    coins: 1600,
    title: 'The big-hearted',
    price: '$9.99',
    tint: 'butter' as const,
  },
];

export function CoinStore({
  balance,
  onClose,
  onBalance,
}: {
  balance: number;
  onClose: () => void;
  onBalance: (balance: number) => void;
}) {
  const [busySku, setBusySku] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [serverSetupMessage, setServerSetupMessage] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [catalogRevision, setCatalogRevision] = useState(0);
  const finishRef = useRef<
    ((input: { purchase: Purchase; isConsumable?: boolean }) => Promise<void>) | null
  >(null);
  const verifyAndFinish = useCallback(
    async (purchase: Purchase) => {
      try {
        const { data, error } = await requireSupabase().functions.invoke('verify-coin-purchase', {
          body: { purchase },
        });
        if (error) throw error;
        if (!data?.verified)
          throw new Error(data?.message ?? 'The store could not verify this purchase.');
        onBalance(Number(data.balance));
        if (finishRef.current) await finishRef.current({ purchase, isConsumable: true });
        setFeedbackError(false);
        setErrorText('Coins added. They’re ready to send.');
      } catch (error) {
        setFeedbackError(true);
        setErrorText(error instanceof Error ? error.message : 'Purchase verification failed.');
      } finally {
        setBusySku(null);
      }
    },
    [onBalance],
  );

  const { connected, products, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    onPurchaseSuccess: verifyAndFinish,
    onPurchaseError: (error) => {
      setBusySku(null);
      setFeedbackError(true);
      setErrorText(error.message);
    },
  });
  useEffect(() => {
    finishRef.current = finishTransaction;
  }, [finishTransaction]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    setCatalogError('');
    void fetchProducts({ skus: packs.map((pack) => pack.sku), type: 'in-app' }).catch(() => {
      if (active) setCatalogError('Could not load coin packs. Please try again.');
    });
    return () => {
      active = false;
    };
  }, [connected, fetchProducts, catalogRevision]);
  useEffect(() => {
    let active = true;
    if (!backendReady) {
      setServerReady(false);
      setServerSetupMessage('Purchases are unavailable in this demo.');
      return;
    }
    void requireSupabase()
      .functions.invoke('verify-coin-purchase', {
        body: { action: 'readiness', platform: Platform.OS },
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        setServerReady(Boolean(data?.ready));
        setServerSetupMessage(
          'Coin purchases are temporarily unavailable. Please try again later.',
        );
      })
      .catch(() => {
        if (!active) return;
        setServerReady(false);
        setServerSetupMessage('We could not connect to the store. Please try again later.');
      });
    return () => {
      active = false;
    };
  }, []);

  const buy = async (sku: string) => {
    setBusySku(sku);
    setFeedbackError(false);
    setErrorText('');
    try {
      const {
        data: { user },
      } = await requireSupabase().auth.getUser();
      if (!user) throw new Error('Sign in before buying coins.');
      await requestPurchase({
        request: {
          apple: { sku, appAccountToken: user.id },
          google: { skus: [sku], obfuscatedAccountId: user.id.replaceAll('-', '') },
        },
        type: 'in-app',
      });
    } catch (error) {
      setBusySku(null);
      setFeedbackError(true);
      setErrorText(error instanceof Error ? error.message : 'Could not start the purchase.');
    }
  };

  const refreshBalance = async () => {
    setFeedbackError(false);
    setErrorText('Refreshing your account balance…');
    if (!backendReady) {
      onBalance(balance);
      setFeedbackError(false);
      setErrorText('Your demo balance is up to date for this session.');
      return;
    }
    try {
      const client = requireSupabase();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) throw new Error('Sign in to refresh your wallet.');
      const { data, error } = await client
        .from('coin_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .single();
      if (error) throw error;
      onBalance(Number(data.balance));
      setFeedbackError(false);
      setErrorText('Your account balance is up to date.');
    } catch (error) {
      setFeedbackError(true);
      setErrorText(error instanceof Error ? error.message : 'Could not refresh your wallet.');
    }
  };

  return (
    <Sheet
      title="A little appreciation."
      eyebrow="CIRCLES WALLET"
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Pressable
            style={{ minHeight: 48, justifyContent: 'center' }}
            onPress={() => void refreshBalance()}
          >
            <Text style={styles.restore}>Refresh balance</Text>
          </Pressable>
          <ActionButton compact variant="outline" label="Done" onPress={onClose} />
        </View>
      }
    >
      <Text style={styles.copy}>
        Coins stay in your account and can be used to send gifts during live rooms.
      </Text>
      {packs.map((pack) => {
        const product = products.find((item) => item.id === pack.sku);
        const price = product?.displayPrice ?? pack.price;
        return (
          <View key={pack.sku} style={[styles.pack, { backgroundColor: colors[pack.tint] }]}>
            <View style={styles.coinIcon}>
              <Text style={{ fontSize: 20, color: colors.ink }}>◉</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.packTitle}>{pack.title}</Text>
              <Text style={styles.packDetail}>{pack.coins.toLocaleString()} coins</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Buy ${pack.coins} coins for ${price}`}
              style={[
                styles.buy,
                {
                  opacity:
                    !connected ||
                    !backendReady ||
                    serverReady !== true ||
                    !product ||
                    busySku !== null
                      ? 0.45
                      : 1,
                },
              ]}
              disabled={
                !connected || !backendReady || serverReady !== true || !product || busySku !== null
              }
              onPress={() => void buy(pack.sku)}
            >
              <Text style={styles.buyText}>{busySku === pack.sku ? '…' : price}</Text>
            </Pressable>
          </View>
        );
      })}
      <Text style={styles.storeHint}>
        {serverReady === false
          ? serverSetupMessage
          : !connected
            ? 'Connect to the App Store or Google Play to load coin packs.'
            : packs.some((pack) => !products.some((product) => product.id === pack.sku))
              ? 'Some coin packs are temporarily unavailable. Please try again later.'
              : serverReady === null
                ? 'Checking secure store verification…'
                : 'Purchases are verified before coins are added.'}
      </Text>
      {catalogError ? (
        <View>
          <Text accessibilityRole="alert" style={styles.feedback}>
            {catalogError}
          </Text>
          <ActionButton
            compact
            variant="outline"
            label="Retry loading coin packs"
            onPress={() => setCatalogRevision((value) => value + 1)}
          />
        </View>
      ) : null}
      {errorText ? (
        <Text style={[styles.feedback, { color: feedbackError ? colors.error : colors.ink }]}>
          {errorText}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = createThemedStyles(() => ({
  copy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
    marginBottom: 17,
    maxWidth: 300,
  },
  pack: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 19,
    padding: 13,
    marginBottom: 9,
  },
  coinIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  packTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  packDetail: { color: colors.muted, fontSize: 14, marginTop: 2 },
  buy: {
    minHeight: 48,
    justifyContent: 'center',
    minWidth: 70,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 13,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buyText: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  storeHint: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  feedback: { color: colors.error, fontSize: 14, marginTop: 8 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 17,
  },
  restore: { color: colors.muted, fontSize: 14, fontWeight: '700', padding: 8 },
}));
