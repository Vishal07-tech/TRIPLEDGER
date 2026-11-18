import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/AuthContext';
import { ActionMenu, type ActionMenuItem } from '../../components/ActionMenu';
import { FadeIn } from '../../components/FadeIn';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatTile } from '../../components/StatTile';
import { WelcomeTour } from '../../components/WelcomeTour';
import { useTrips } from '../../hooks/useTrips';
import { ApiError } from '../../services/api/apiClient';
import { hasSeenOnboarding, markOnboardingSeen } from '../../services/storage/onboarding';
import { colors, radius, shadow, spacing } from '../../theme/tokens';
import type { AppStackParamList } from '../../types/auth';
import type { Trip } from '../../types/trips';
import { TripCard } from '../trips/components/TripCard';

type Props = NativeStackScreenProps<AppStackParamList, 'Home'>;

const COMPLETED: Trip['status'][] = ['TRIP_CLOSED', 'FULLY_SETTLED'];

export default function HomeScreen({ navigation }: Props) {
  const { user, notice, logout, error } = useAuth();
  const { data, error: tripsError, isError, isPending, refetch } = useTrips();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const [askingLocation, setAskingLocation] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  // First launch: introduce the app, then ask for location. After that the tour
  // is remembered and the permission prompt only appears while it is missing.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const seen = await hasSeenOnboarding();
      if (!mounted) return;

      setShowTour(!seen);
      setOnboardingChecked(true);

      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (mounted && permission.status !== 'granted') setShowLocationPrompt(true);
      } catch {
        // Devices that cannot report permission simply skip the prompt.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function finishTour() {
    setShowTour(false);
    await markOnboardingSeen();
  }

  async function enableLocation() {
    if (askingLocation) return;
    setAskingLocation(true);
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // The live location screen explains how to fix a blocked permission.
    } finally {
      setAskingLocation(false);
      setShowLocationPrompt(false);
    }
  }

  const trips = useMemo(
    () => [...(data ?? [])].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    [data],
  );
  const activeCount = trips.filter((trip) => !COMPLETED.includes(trip.status)).length;
  const travelerCount = new Set(
    trips.flatMap((trip) => trip.members.filter((member) => member.isActive).map((member) => member.userId)),
  ).size;
  const recentTrips = trips.slice(0, 3);
  const firstName = (user?.fullName || 'traveler').split(' ')[0];
  const liveTrip = trips.find((trip) => !COMPLETED.includes(trip.status)) ?? trips[0];

  function openLiveLocation() {
    if (!liveTrip) return;
    navigation.navigate('LiveLocation', { tripId: liveTrip.id, tripName: liveTrip.name });
  }

  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // Keep the current screen if secure token deletion fails; AuthContext surfaces the error.
    } finally {
      setLoggingOut(false);
    }
  }

  const menuItems: ActionMenuItem[] = [
    {
      key: 'create',
      label: 'Create Trip',
      description: 'Name it, set the dates, get a share code.',
      icon: '＋',
      testID: 'menu-create-trip',
      onPress: () => navigation.navigate('CreateTrip'),
    },
    {
      key: 'join',
      label: 'Join a Trip',
      description: 'Enter the code a friend shared with you.',
      icon: '#',
      testID: 'menu-join-trip',
      onPress: () => navigation.navigate('JoinTrip'),
    },
    {
      key: 'trips',
      label: 'My Trips',
      description: 'Every trip you belong to, with dates and totals.',
      icon: '☰',
      testID: 'menu-my-trips',
      onPress: () => navigation.navigate('MyTrips'),
    },
    {
      key: 'location',
      label: 'Live location',
      description: liveTrip
        ? `See where everyone is on ${liveTrip.name}.`
        : 'Create or join a trip to share location.',
      icon: '◎',
      testID: 'menu-live-location',
      onPress: () => (liveTrip ? openLiveLocation() : navigation.navigate('CreateTrip')),
    },
    {
      key: 'signout',
      label: loggingOut ? 'Signing out…' : 'Sign out',
      description: 'Remove the saved session from this device.',
      icon: '⏻',
      tone: 'danger',
      testID: 'menu-sign-out',
      onPress: () => void signOut(),
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image
              accessibilityLabel="Sutrula Payanam logo"
              source={require('../../../assets/icon.png')}
              style={styles.brandLogo}
            />
            <View>
              <Text style={styles.brand}>SUTRULA PAYANAM</Text>
              <Text style={styles.kicker}>TRAVEL TOGETHER</Text>
            </View>
          </View>
          <Pressable
            accessibilityHint="Opens create, join, trips and sign out"
            accessibilityLabel="Open quick actions"
            accessibilityRole="button"
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [styles.plusButton, pressed ? styles.pressed : null]}
            testID="home-menu"
          >
            <Text style={styles.plus}>＋</Text>
          </Pressable>
        </View>

        {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.authError}>{error}</Text> : null}

        <FadeIn delay={40}>
          <View style={styles.hero}>
          <View style={styles.heroGlowOne} />
          <View style={styles.heroGlowTwo} />
          <Text style={styles.heroEyebrow}>WELCOME BACK, {firstName.toUpperCase()}</Text>
          <Text style={styles.heroTitle}>Welcome, {user?.fullName || 'traveler'}.</Text>
          <Text style={styles.heroBody}>
            Plan the trip, split the spend, and keep every rupee clear for everyone travelling with you.
          </Text>
          <View style={styles.heroActions}>
            <View style={styles.heroAction}>
              <PrimaryButton
                accessibilityHint="Opens the create trip form"
                label="Create a trip"
                onPress={() => navigation.navigate('CreateTrip')}
                testID="home-create-trip"
                icon="＋"
              />
            </View>
            <View style={styles.heroAction}>
              <PrimaryButton
                accessibilityHint="Opens the join with code screen"
                label="Join with code"
                onPress={() => navigation.navigate('JoinTrip')}
                testID="home-join-trip"
                variant="secondary"
                icon="#"
              />
            </View>
          </View>
          </View>
        </FadeIn>

        <FadeIn delay={100}>
          <View style={styles.statsRow}>
            <StatTile label="Trips" tone="primary" value={String(trips.length)} testID="home-stat-trips" />
            <StatTile label="Active now" tone="secondary" value={String(activeCount)} testID="home-stat-active" />
            <StatTile label="Travellers" tone="success" value={String(travelerCount)} testID="home-stat-people" />
          </View>
        </FadeIn>

        {liveTrip ? (
          <FadeIn delay={150}>
            <Pressable
              accessibilityHint="Opens the live location map for your current trip"
              accessibilityRole="button"
              onPress={openLiveLocation}
              style={({ pressed }) => [styles.liveCard, pressed ? styles.pressed : null]}
              testID="home-live-location"
            >
              <View style={styles.liveIcon}>
                <Text style={styles.liveIconText}>◎</Text>
              </View>
              <View style={styles.liveText}>
                <Text style={styles.liveTitle}>Live location</Text>
                <Text numberOfLines={1} style={styles.liveBody}>
                  See where everyone is on {liveTrip.name}.
                </Text>
              </View>
              <Text style={styles.liveArrow}>→</Text>
            </Pressable>
          </FadeIn>
        ) : null}

        <FadeIn delay={190}>
          <View style={styles.sectionHeader}>
            <View>
              <Text accessibilityRole="header" style={styles.sectionTitle}>Recent trips</Text>
              <Text style={styles.sectionSubtitle}>Pick up where you left off.</Text>
            </View>
            <Pressable
              accessibilityHint="Opens the full trip list"
              accessibilityLabel="My Trips"
              accessibilityRole="button"
              onPress={() => navigation.navigate('MyTrips')}
              style={({ pressed }) => [styles.seeAll, pressed ? styles.pressed : null]}
              testID="home-my-trips"
            >
              <Text style={styles.seeAllText}>My Trips</Text>
              <Text style={styles.seeAllArrow}>→</Text>
            </Pressable>
          </View>
        </FadeIn>

        {isPending ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading your trips…</Text>
          </View>
        ) : isError ? (
          <View style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorTitle}>Couldn’t load your trips</Text>
            <Text style={styles.errorBody}>
              {tripsError instanceof ApiError
                ? tripsError.message
                : 'Check your connection and try again.'}
            </Text>
            <PrimaryButton label="Try again" onPress={() => void refetch()} testID="home-trips-retry" variant="secondary" />
          </View>
        ) : recentTrips.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyMark}><Text style={styles.emptyMarkText}>✈</Text></View>
            <Text style={styles.emptyTitle}>No trips yet</Text>
            <Text style={styles.emptyBody}>
              Create your first trip and share the code with the people coming along. Group spending will show up
              on everyone’s phone.
            </Text>
            <PrimaryButton label="Create your first trip" onPress={() => navigation.navigate('CreateTrip')} testID="home-empty-create" />
          </View>
        ) : (
          <View style={styles.tripList}>
            {recentTrips.map((trip, index) => (
              <FadeIn delay={220 + index * 70} key={trip.id}>
                <TripCard
                  onPress={() => navigation.navigate('TripDetail', { tripId: trip.id, tripName: trip.name })}
                  trip={trip}
                />
              </FadeIn>
            ))}
          </View>
        )}

        <Text style={styles.footer}>Manual payments only · No shared cash pool · Codes stay private to your crew</Text>
      </ScrollView>

      <ActionMenu
        items={menuItems}
        onClose={() => setMenuOpen(false)}
        subtitle={user?.email}
        title="Quick actions"
        visible={menuOpen}
      />

      <WelcomeTour onDone={() => void finishTour()} visible={showTour} />

      <Modal
        animationType="fade"
        onRequestClose={() => setShowLocationPrompt(false)}
        transparent
        visible={showLocationPrompt && onboardingChecked && !showTour}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalMark}>
              <Text style={styles.modalMarkText}>◎</Text>
            </View>
            <Text style={styles.modalTitle}>Find each other on the trip</Text>
            <Text style={styles.modalBody}>
              Allow location so your trip can see where you are if you get separated. Sharing is per trip, only
              members can see it, and you can switch it off any time.
            </Text>
            <PrimaryButton
              label="Allow location"
              loading={askingLocation}
              onPress={() => void enableLocation()}
              testID="home-location-allow"
            />
            <PrimaryButton
              label="Not now"
              onPress={() => setShowLocationPrompt(false)}
              testID="home-location-later"
              variant="ghost"
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  brandLogo: { borderRadius: 12, height: 40, width: 40 },
  brand: { color: colors.foreground, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  kicker: { color: colors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 1.6, marginTop: 2 },
  plusButton: {
    alignItems: 'center',
    backgroundColor: colors.foreground,
    borderRadius: radius.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
    ...shadow.card,
  },
  plus: { color: colors.card, fontSize: 26, fontWeight: '500', lineHeight: 30 },
  pressed: { opacity: 0.75 },
  notice: { color: colors.success, fontSize: 13, fontWeight: '600' },
  authError: { color: colors.destructive, fontSize: 13, fontWeight: '600' },
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    padding: spacing.lg,
    ...shadow.raised,
  },
  heroGlowOne: {
    backgroundColor: colors.primary,
    borderRadius: 120,
    height: 200,
    opacity: 0.32,
    position: 'absolute',
    right: -70,
    top: -90,
    width: 200,
  },
  heroGlowTwo: {
    backgroundColor: colors.secondary,
    borderRadius: 90,
    bottom: -80,
    height: 160,
    left: -60,
    opacity: 0.22,
    position: 'absolute',
    width: 160,
  },
  heroEyebrow: { color: colors.primarySoft, fontSize: 11, fontWeight: '800', letterSpacing: 1.8 },
  heroTitle: { color: colors.card, fontSize: 28, fontWeight: '800', letterSpacing: -0.6, lineHeight: 34, marginTop: spacing.sm },
  heroBody: { color: '#CBD5E1', fontSize: 14, lineHeight: 21, marginTop: spacing.sm, maxWidth: 320 },
  heroActions: { gap: spacing.sm, marginTop: spacing.lg },
  heroAction: {},
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  liveCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderStrong,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    ...shadow.card,
  },
  liveIcon: {
    alignItems: 'center',
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.input,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  liveIconText: { color: colors.secondary, fontSize: 20, fontWeight: '800' },
  liveText: { flex: 1, gap: 2 },
  liveTitle: { color: colors.foreground, fontSize: 15, fontWeight: '800' },
  liveBody: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  liveArrow: { color: colors.secondary, fontSize: 18, fontWeight: '800' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  sectionTitle: { color: colors.foreground, fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  sectionSubtitle: { color: colors.mutedForeground, fontSize: 13, marginTop: 2 },
  seeAll: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minHeight: 44, paddingLeft: spacing.md },
  seeAllText: { color: colors.primaryDark, fontSize: 14, fontWeight: '800' },
  seeAllArrow: { color: colors.primaryDark, fontSize: 16, fontWeight: '700' },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 96,
  },
  loadingText: { color: colors.mutedForeground, fontSize: 14 },
  errorCard: {
    backgroundColor: colors.card,
    borderColor: colors.destructiveSoft,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorTitle: { color: colors.destructive, fontSize: 15, fontWeight: '800' },
  errorBody: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyMark: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  emptyMarkText: { color: colors.primaryDark, fontSize: 24 },
  emptyTitle: { color: colors.foreground, fontSize: 19, fontWeight: '800' },
  emptyBody: { color: colors.mutedForeground, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  tripList: { gap: spacing.sm },
  footer: { color: colors.subtle, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: radius.sheet,
    gap: spacing.sm,
    padding: spacing.lg,
    width: '100%',
    ...shadow.raised,
  },
  modalMark: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.pill,
    height: 56,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 56,
  },
  modalMarkText: { color: colors.secondary, fontSize: 26, fontWeight: '800' },
  modalTitle: { color: colors.foreground, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  modalBody: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
});
