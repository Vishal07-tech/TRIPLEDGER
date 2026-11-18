import type { PropsWithChildren } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme/tokens';
import { FadeIn } from './FadeIn';

export function AuthLayout({ children, subtitle }: PropsWithChildren<{ subtitle: string }>) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <FadeIn style={styles.brandRow}>
            <Image
              accessibilityLabel="Sutrula Payanam logo"
              source={require('../../assets/icon.png')}
              style={styles.brandLogo}
            />
            <View style={styles.brandText}>
              <Text style={styles.brandName}>SUTRULA PAYANAM</Text>
              <Text style={styles.brandCaption}>Travel together, stay clear.</Text>
            </View>
          </FadeIn>
          <FadeIn delay={90}>
            <View style={styles.card}>
              <Text style={styles.title}>{subtitle}</Text>
              <Text style={styles.description}>Your trip finances, thoughtfully organized.</Text>
              {children}
            </View>
          </FadeIn>
          <FadeIn delay={160}>
            <Text style={styles.footer}>
              Your account and trip access are protected by the Sutrula Payanam server.
            </Text>
          </FadeIn>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.xl },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  brandLogo: { borderRadius: 16, height: 56, width: 56 },
  brandText: { flex: 1 },
  brandName: { color: colors.foreground, fontSize: 15, fontWeight: '900', letterSpacing: 1.4 },
  brandCaption: { color: colors.secondary, fontSize: 13, marginTop: 3 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 24, borderWidth: 1, padding: spacing.lg, shadowColor: colors.foreground, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 },
  title: { color: colors.foreground, fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  description: { color: colors.mutedForeground, fontSize: 15, lineHeight: 22, marginBottom: spacing.lg, marginTop: spacing.xs },
  footer: { alignSelf: 'center', color: colors.mutedForeground, fontSize: 13, lineHeight: 19, maxWidth: 320, textAlign: 'center' },
});
