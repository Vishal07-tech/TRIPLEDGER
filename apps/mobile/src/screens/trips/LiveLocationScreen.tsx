import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/AuthContext';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TripMap } from '../../components/TripMap';
import { useTripLocations, tripLocationsQueryKey } from '../../hooks/useTripLocations';
import { tripService } from '../../services/api/tripService';
import { colors, radius, shadow, spacing } from '../../theme/tokens';
import type { AppStackParamList } from '../../types/auth';
import {
  distanceMeters,
  formatDistance,
  formatLocationAge,
  mapsUrlFor,
} from '../../utils/geo';

type Props = NativeStackScreenProps<AppStackParamList, 'LiveLocation'>;

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function LiveLocationScreen({ navigation, route }: Props) {
  const { tripId, tripName } = route.params;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, error, isPending, refetch, isRefetching } = useTripLocations(tripId);

  const [permission, setPermission] = useState<string>('unknown');
  const [isSharing, setIsSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  // Show a map immediately: even with sharing off, this device's own position is
  // drawn locally so the screen is never an empty box. It is never uploaded until
  // the switch is turned on.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const result = await Location.getForegroundPermissionsAsync();
        if (mounted) setPermission(result.status);
        if (result.status !== 'granted') return;

        const lastKnown = await Location.getLastKnownPositionAsync();
        if (mounted && lastKnown) {
          setPreview({
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
          });
        }

        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (mounted) {
          setPreview({
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
          });
        }
      } catch {
        if (mounted) setPermission((status) => (status === 'unknown' ? 'denied' : status));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Leaving the screen stops the updates. The last position stays visible to the
  // group with its age, which is what someone looking for a missing friend needs.
  useEffect(
    () => () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    },
    [],
  );

  const currentUserId = user?.id;

  const rows = useMemo(() => {
    const members = data?.members ?? [];
    const me = members.find((member) => member.userId === currentUserId);
    const origin =
      me?.isSharing && me.latitude !== null && me.longitude !== null
        ? { latitude: me.latitude, longitude: me.longitude }
        : null;

    return members
      .map((member) => ({
        ...member,
        distance:
          origin && member.latitude !== null && member.longitude !== null
            ? distanceMeters(origin, { latitude: member.latitude, longitude: member.longitude })
            : null,
      }))
      .sort((left, right) => {
        if (left.distance === null && right.distance === null) return left.fullName.localeCompare(right.fullName);
        if (left.distance === null) return 1;
        if (right.distance === null) return -1;
        return left.distance - right.distance;
      });
  }, [currentUserId, data]);

  const sharingCount = rows.filter((row) => row.isSharing).length;

  const sharingPins = useMemo(
    () =>
      rows
        .filter((row) => row.isSharing && row.latitude !== null && row.longitude !== null)
        .map((row) => ({
          id: row.userId,
          latitude: row.latitude as number,
          longitude: row.longitude as number,
          label: initials(row.fullName),
          isSelf: row.userId === currentUserId,
        })),
    [currentUserId, rows],
  );

  const selectedRow = useMemo(
    () => rows.find((row) => row.userId === selectedId) ?? null,
    [rows, selectedId],
  );

  // With nobody sharing, the map still opens around this phone's own position.
  const mapPins = useMemo(() => {
    if (sharingPins.length > 0) return sharingPins;
    if (!preview || !currentUserId) return [];
    return [{
      id: currentUserId,
      latitude: preview.latitude,
      longitude: preview.longitude,
      label: initials(user?.fullName ?? 'You'),
      isSelf: true,
    }];
  }, [currentUserId, preview, sharingPins, user?.fullName]);

  // A member who stops sharing should not leave a stale card behind.
  useEffect(() => {
    if (!selectedId) return;
    if (!rows.some((row) => row.userId === selectedId && row.isSharing)) {
      setSelectedId(null);
    }
  }, [rows, selectedId]);

  async function publishPosition(position: Location.LocationObject) {
    try {
      await tripService.shareTripLocation(tripId, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? undefined,
        capturedAt: new Date(position.timestamp).toISOString(),
      });
      setMessage('');
      await queryClient.invalidateQueries({ queryKey: tripLocationsQueryKey(tripId) });
    } catch {
      setMessage('Could not update your location. Check your connection.');
    }
  }

  async function startSharing() {
    if (busy) return;
    setBusy(true);
    setMessage('');

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setMessage('Turn on your phone’s location (GPS), then try again.');
        return;
      }

      let status = permission;
      if (status !== 'granted') {
        const requested = await Location.requestForegroundPermissionsAsync();
        status = requested.status;
        setPermission(status);
      }

      if (status !== 'granted') {
        setMessage('Location permission is off. Enable it in Settings so your trip can see where you are.');
        return;
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15_000,
          distanceInterval: 10,
        },
        (position) => {
          setPreview({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          void publishPosition(position);
        },
      );

      subscriptionRef.current?.remove();
      subscriptionRef.current = subscription;
      setIsSharing(true);

      // Keep the initial fix visible while the first upload is in flight.
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setPreview({
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        });
      } catch {
        // The watcher above will publish as soon as the phone reports a fix.
      }
    } catch {
      setMessage('Could not start location sharing. Try again.');
    } finally {
      setBusy(false);
    }
  }

  /** One-off local fix used only to draw the map; nothing is uploaded. */
  async function locateMe() {
    if (locating) return;
    setLocating(true);
    setMessage('');

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setMessage('Turn on your phone’s location (GPS), then try again.');
        return;
      }

      let status = permission;
      if (status !== 'granted') {
        const requested = await Location.requestForegroundPermissionsAsync();
        status = requested.status;
        setPermission(status);
      }

      if (status !== 'granted') {
        setMessage('Location permission is off. Enable it in Settings to show your position on the map.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPreview({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch {
      setMessage('Could not read your position. Move somewhere with a clearer view of the sky and try again.');
    } finally {
      setLocating(false);
    }
  }

  async function stopSharing() {
    if (busy) return;
    setBusy(true);
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    setIsSharing(false);

    try {
      await tripService.stopSharingTripLocation(tripId);
      await queryClient.invalidateQueries({ queryKey: tripLocationsQueryKey(tripId) });
      setMessage('You stopped sharing. Your saved position was removed from the trip.');
    } catch {
      setMessage('Could not remove your saved position. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function openMaps(latitude: number, longitude: number) {
    try {
      await Linking.openURL(mapsUrlFor({ latitude, longitude }));
    } catch {
      setMessage('No maps app could be opened on this device.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            colors={[colors.primary]}
            onRefresh={() => void refetch()}
            progressBackgroundColor={colors.card}
            refreshing={isRefetching}
            tintColor={colors.primary}
          />
        )}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
            testID="live-location-back"
          >
            <Text style={styles.backLabel}>← Back</Text>
          </Pressable>
          <View style={styles.tripPill}>
            <Text numberOfLines={1} style={styles.tripPillText}>{tripName}</Text>
          </View>
        </View>

        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>Live location</Text>
          <Text style={styles.subtitle}>
            See where everyone is, so a friend who wanders off or misses the group can be found quickly.
          </Text>
        </View>

        <View style={styles.shareCard}>
          <View style={styles.shareTopRow}>
            <View style={styles.shareText}>
              <Text style={styles.shareTitle}>Share my location</Text>
              <Text style={styles.shareState}>
                {isSharing ? 'On · this phone is visible to the trip' : 'Off · nobody in the trip can see you'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Share my live location with this trip"
              disabled={busy}
              onValueChange={(next) => {
                if (next) void startSharing();
                else void stopSharing();
              }}
              thumbColor={colors.card}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              value={isSharing}
            />
          </View>

          <Text style={styles.shareNote}>
            Your position updates every 15 seconds while this screen is open. Closing it stops updates, and the
            last known spot stays visible with its age until you stop sharing.
          </Text>

          {message ? (
            <Text accessibilityRole="alert" style={styles.message}>{message}</Text>
          ) : null}

          {permission === 'denied' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openSettings()}
              style={({ pressed }) => [styles.settingsButton, pressed ? styles.pressed : null]}
              testID="live-location-settings"
            >
              <Text style={styles.settingsLabel}>Open device settings</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Map</Text>
            <View style={styles.countPill}>
              <Text style={styles.countText}>
                {sharingCount === 0 ? 'Nobody sharing' : `${sharingCount} sharing`}
              </Text>
            </View>
          </View>

          {isPending && mapPins.length === 0 ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.body}>Loading locations…</Text>
            </View>
          ) : mapPins.length === 0 ? (
            <View style={styles.mapEmpty}>
              <Text style={styles.mapEmptyIcon}>◎</Text>
              <Text style={styles.mapEmptyTitle}>Show the map</Text>
              <Text style={styles.mapEmptyBody}>
                Allow location on this phone to see where you are, then turn on sharing so the rest of the trip can
                find you.
              </Text>
              <PrimaryButton
                disabled={locating}
                label={locating ? 'Finding you…' : 'Show my location'}
                onPress={() => void locateMe()}
                testID="live-location-locate"
              />
            </View>
          ) : (
            <View style={styles.mapCard}>
              <TripMap
                height={240}
                onSelect={setSelectedId}
                pins={mapPins}
                selectedId={selectedId}
              />
              <Text style={styles.mapHint}>
                {sharingCount === 0
                  ? 'Sharing is off — only you can see this map.'
                  : selectedRow
                    ? 'Tap another pin to switch'
                    : 'Tap a pin to see who it is'}
              </Text>

              {selectedRow ? (
                <View style={styles.mapSelection} testID="live-location-selection">
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(selectedRow.fullName)}</Text>
                  </View>
                  <View style={styles.memberText}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {selectedRow.userId === currentUserId ? 'You' : selectedRow.fullName}
                    </Text>
                    <Text style={styles.memberMeta} numberOfLines={1}>
                      {selectedRow.userId === currentUserId
                        ? formatLocationAge(selectedRow.updatedAt)
                        : `${selectedRow.distance !== null ? `${formatDistance(selectedRow.distance)} · ` : ''}${formatLocationAge(selectedRow.updatedAt)}`}
                    </Text>
                  </View>
                  {selectedRow.latitude !== null && selectedRow.longitude !== null ? (
                    <Pressable
                      accessibilityLabel={`Open ${selectedRow.fullName} in a maps app`}
                      accessibilityRole="button"
                      onPress={() => void openMaps(selectedRow.latitude!, selectedRow.longitude!)}
                      style={({ pressed }) => [styles.mapButton, pressed ? styles.pressed : null]}
                      testID="live-location-selection-map"
                    >
                      <Text style={styles.mapLabel}>Open</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>On this trip</Text>
            <View style={styles.countPill}>
              <Text style={styles.countText}>
                {sharingCount} of {rows.length} sharing
              </Text>
            </View>
          </View>

          {isPending ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.body}>Loading locations…</Text>
            </View>
          ) : error ? (
            <View style={styles.errorCard}>
              <Text accessibilityRole="alert" style={styles.body}>Couldn’t load locations.</Text>
              <Pressable accessibilityRole="button" onPress={() => void refetch()} testID="live-location-retry">
                <Text style={styles.retryLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : rows.length === 0 ? (
            <Text style={styles.body}>No members on this trip yet.</Text>
          ) : (
            <View style={styles.list}>
              {rows.map((row) => {
                const mine = row.userId === currentUserId;
                const hasPosition = row.latitude !== null && row.longitude !== null;
                const age = formatLocationAge(row.updatedAt);
                const subtitle = !row.isSharing || !hasPosition
                  ? mine
                    ? 'Turn on sharing to be visible'
                    : 'Not sharing location'
                  : mine
                    ? age
                    : row.distance !== null
                      ? `${formatDistance(row.distance)} · ${age}`
                      : age;

                return (
                  <View key={row.userId} style={styles.memberCard} testID={`live-location-member-${row.userId}`}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials(row.fullName)}</Text>
                    </View>
                    <View style={styles.memberText}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {mine ? 'You' : row.fullName}
                        {row.isActive ? '' : ' · inactive'}
                      </Text>
                      <Text style={[styles.memberMeta, row.isSharing ? styles.memberMetaLive : null]} numberOfLines={2}>
                        {subtitle}
                      </Text>
                    </View>
                    {row.isSharing && hasPosition && !mine ? (
                      <Pressable
                        accessibilityLabel={`Open ${row.fullName} on the map`}
                        accessibilityRole="button"
                        onPress={() => void openMaps(row.latitude!, row.longitude!)}
                        style={({ pressed }) => [styles.mapButton, pressed ? styles.pressed : null]}
                        testID={`live-location-map-${row.userId}`}
                      >
                        <Text style={styles.mapLabel}>Map</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.statusDotWrap}>
                        <View style={[styles.statusDot, row.isSharing ? styles.statusDotLive : styles.statusDotOff]} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          Only members of this trip can see these positions. Location is never shared with other trips or shown in
          reports. Android may keep a location icon in the status bar while sharing is on.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  backButton: { justifyContent: 'center', minHeight: 48, paddingRight: spacing.md },
  backLabel: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  tripPill: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    maxWidth: 220,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tripPillText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  heading: { gap: spacing.xs },
  title: { color: colors.foreground, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21 },
  shareCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    ...shadow.card,
  },
  shareTopRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  shareText: { flex: 1, gap: 2 },
  shareTitle: { color: colors.foreground, fontSize: 16, fontWeight: '800' },
  shareState: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  shareNote: { color: colors.subtle, fontSize: 11, lineHeight: 16 },
  message: { color: colors.destructive, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  settingsButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.input,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  settingsLabel: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  section: { gap: spacing.sm, marginTop: spacing.xs },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: colors.foreground, fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
  countPill: {
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  countText: { color: colors.mutedForeground, fontSize: 11, fontWeight: '700' },
  mapCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    overflow: 'hidden',
    padding: spacing.sm,
    ...shadow.card,
  },
  mapHint: { color: colors.subtle, fontSize: 11, paddingHorizontal: spacing.xs, textAlign: 'center' },
  mapSelection: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.input,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  mapEmpty: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.lg,
    ...shadow.card,
  },
  mapEmptyIcon: { color: colors.secondary, fontSize: 28, fontWeight: '800' },
  mapEmptyTitle: { color: colors.foreground, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  mapEmptyBody: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 88,
  },
  errorCard: {
    backgroundColor: colors.card,
    borderColor: colors.destructiveSoft,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  retryLabel: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  body: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  list: { gap: spacing.sm },
  memberCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
  memberText: { flex: 1, gap: 1 },
  memberName: { color: colors.foreground, fontSize: 14, fontWeight: '800' },
  memberMeta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  memberMetaLive: { color: colors.success, fontWeight: '700' },
  mapButton: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.input,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  mapLabel: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  statusDotWrap: { paddingHorizontal: spacing.sm },
  statusDot: { borderRadius: radius.pill, height: 10, width: 10 },
  statusDotLive: { backgroundColor: colors.success },
  statusDotOff: { backgroundColor: colors.subtle },
  footer: { color: colors.subtle, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
