import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, ScrollView, Text, View } from 'react-native';
import { useIAP, type Purchase } from 'expo-iap';
import { colors, radii } from '../theme';
import { backendReady, requireSupabase } from '../lib/supabase';
import { ActionButton } from './Primitives';

const packs = [
  {
    sku: 'com.circles.coins.120',
    coins: 120,
    title: 'A little love',
    price: '$0.99',
    tint: colors.sage,
  },
  {
    sku: 'com.circles.coins.700',
    coins: 700,
    title: 'A lovely bunch',
    price: '$4.99',
    tint: colors.lilac,
  },
  {
    sku: 'com.circles.coins.1600',
    coins: 1600,
    title: 'The big-hearted',
    price: '$9.99',
    tint: colors.butter,
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
    <View style={styles.container}>
      <ScrollView style={{ maxHeight: '92%' }} contentContainerStyle={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>CIRCLES WALLET</Text>
            <Text style={styles.title}>A little appreciation.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>
        <Text style={styles.copy}>
          Coins stay in your account and can be used to send gifts during live rooms.
        </Text>
        {packs.map((pack) => {
          const product = products.find((item) => item.id === pack.sku);
          const price = product?.displayPrice ?? pack.price;
          return (
            <View key={pack.sku} style={[styles.pack, { backgroundColor: pack.tint }]}>
              <View style={styles.coinIcon}>
                <Text style={{ fontSize: 20 }}>◉</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.packTitle}>{pack.title}</Text>
                <Text style={styles.packDetail}>{pack.coins.toLocaleString()} coins</Text>
              </View>
              <Pressable
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
                  !connected ||
                  !backendReady ||
                  serverReady !== true ||
                  !product ||
                  busySku !== null
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
          <Text style={[styles.feedback, { color: feedbackError ? '#B73543' : colors.ink }]}>
            {errorText}
          </Text>
        ) : null}
        <View style={styles.footer}>
          <Pressable
            style={{ minHeight: 48, justifyContent: 'center' }}
            onPress={() => void refreshBalance()}
          >
            <Text style={styles.restore}>Refresh balance</Text>
          </Pressable>
          <ActionButton compact variant="outline" label="Done" onPress={onClose} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(24,22,25,0.45)',
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 20,
    paddingBottom: 36,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D9D1C9',
    alignSelf: 'center',
    marginBottom: 22,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: {
    color: colors.coral,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  title: { color: colors.ink, fontSize: 23, fontWeight: '800', letterSpacing: -0.6 },
  close: {
    backgroundColor: '#FFFFFF',
    width: 48,
    height: 48,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: { color: colors.ink, fontSize: 26, lineHeight: 29 },
  copy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
    marginBottom: 17,
    maxWidth: 300,
  },
  pack: {
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
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  packTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  packDetail: { color: colors.muted, fontSize: 12, marginTop: 2 },
  buy: {
    minHeight: 48,
    justifyContent: 'center',
    minWidth: 70,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    paddingHorizontal: 13,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buyText: { color: colors.ink, fontWeight: '800', fontSize: 12 },
  storeHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  feedback: { color: colors.live, fontSize: 12, marginTop: 8 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 17,
  },
  restore: { color: colors.muted, fontSize: 12, fontWeight: '700', padding: 8 },
});
