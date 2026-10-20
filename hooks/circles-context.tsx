import React, { createContext, useContext, useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { trpc } from "@/lib/trpc";
import { startOAuthLogin } from "@/constants/oauth";
import { Button, C, IconButton, Logo, T } from "@/components/circles-ui";

type State = {
  user: { id: number; name: string | null } | null;
  authLoading: boolean;
  requireAuth: (action?: () => void) => boolean;
  notify: (message: string) => void;
  refresh: () => void;
  showLogin: () => void;
};
const Context = createContext<State | null>(null);
export function CirclesProvider({ children }: { children: React.ReactNode }) {
  const auth = trpc.auth.me.useQuery(undefined, {
    refetchInterval: 15000,
    retry: false,
  });
  const [login, setLogin] = useState(false);
  const [notice, setNotice] = useState("");
  const [signing, setSigning] = useState(false);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (auth.data) setLogin(false);
  }, [auth.data]);
  const requireAuth = (action?: () => void) => {
    if (!auth.data) {
      setLogin(true);
      return false;
    }
    action?.();
    return true;
  };
  return (
    <Context.Provider
      value={{
        user: auth.data || null,
        authLoading: auth.isLoading,
        requireAuth,
        notify: setNotice,
        refresh: () => {
          void auth.refetch();
        },
        showLogin: () => setLogin(true),
      }}
    >
      {children}
      {!!notice && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 90,
            left: 24,
            right: 24,
            alignItems: "center",
            zIndex: 100,
          }}
        >
          <View
            style={{
              backgroundColor: C.ink,
              paddingHorizontal: 20,
              paddingVertical: 13,
              borderRadius: 14,
              maxWidth: 480,
            }}
          >
            <T style={{ color: "#fff", textAlign: "center" }}>{notice}</T>
          </View>
        </View>
      )}
      <Modal
        transparent
        visible={login}
        animationType="fade"
        onRequestClose={() => setLogin(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#19201B88",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: C.paper,
              borderRadius: 26,
              padding: 28,
              width: "100%",
              maxWidth: 390,
              gap: 16,
            }}
          >
            <View style={{ alignSelf: "flex-end" }}>
              <IconButton
                icon="close"
                onPress={() => setLogin(false)}
                label="Close sign in"
              />
            </View>
            <Logo size={58} />
            <T
              style={{
                fontSize: 29,
                lineHeight: 35,
                fontWeight: "800",
                letterSpacing: -1,
              }}
            >
              Your people are here.
            </T>
            <T style={{ color: C.muted }}>
              Sign in to make a circle, share your moments, and keep the
              conversation going.
            </T>
            <Button
              title={signing ? "Opening sign in…" : "Continue with Manus"}
              loading={signing}
              onPress={async () => {
                setSigning(true);
                try {
                  await startOAuthLogin();
                } catch (err) {
                  setNotice(
                    err instanceof Error
                      ? err.message
                      : "Sign in could not open. Please try again.",
                  );
                } finally {
                  setSigning(false);
                }
              }}
            />
            <Pressable onPress={() => setLogin(false)}>
              <T
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  color: C.muted,
                  padding: 7,
                }}
              >
                Keep exploring for now
              </T>
            </Pressable>
            <T
              style={{
                textAlign: "center",
                fontSize: 10,
                color: C.muted,
                lineHeight: 16,
              }}
            >
              Secure account sign-in. No password to remember.
            </T>
          </View>
        </View>
      </Modal>
    </Context.Provider>
  );
}
export function useCircles() {
  const state = useContext(Context);
  if (!state) throw new Error("CirclesProvider missing");
  return state;
}
