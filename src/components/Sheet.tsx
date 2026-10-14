import React from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
  Text,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../theme';
import { styles } from '../appStyles';
export function Sheet({
  title,
  eyebrow,
  onClose,
  children,
  footer,
}: {
  footer?: React.ReactNode;
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  return (
    <Modal transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.modalShade, { paddingTop: insets.top }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheetPanel, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              {eyebrow ? <Text style={styles.sheetEyebrow}>{eyebrow}</Text> : null}
              <Text style={styles.sheetTitle}>{title}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {children}
            <View style={{ height: 24 }} />
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
