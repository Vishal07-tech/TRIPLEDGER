import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import HomeScreen from '../screens/home/HomeScreen';
import CreateTripScreen from '../screens/trips/CreateTripScreen';
import JoinTripScreen from '../screens/trips/JoinTripScreen';
import LiveLocationScreen from '../screens/trips/LiveLocationScreen';
import MyTripsScreen from '../screens/trips/MyTripsScreen';
import ReportExpenseScreen from '../screens/trips/ReportExpenseScreen';
import TripDetailScreen from '../screens/trips/TripDetailScreen';
import { colors, spacing } from '../theme/tokens';
import type { AppStackParamList, AuthStackParamList } from '../types/auth';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

function LoadingScreen() {
  return <View style={styles.centered} accessibilityRole="progressbar"><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.helper}>Restoring your secure session…</Text></View>;
}

function RestoreErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>Couldn’t restore your session</Text>
      <Text style={styles.helper}>Check your connection, then try again. Your saved token remains in secure storage.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : null]}>
        <Text style={styles.retryLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootNavigator() {
  const { status, restoreSession } = useAuth();
  if (status === 'restoring') return <LoadingScreen />;
  if (status === 'error') return <RestoreErrorScreen onRetry={() => void restoreSession()} />;
  return (
    <NavigationContainer>
      {status === 'unauthenticated' ? (
        <AuthStack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
          <AuthStack.Screen name="Register" component={RegisterScreen} />
        </AuthStack.Navigator>
      ) : null}
      {status === 'authenticated' ? (
        <AppStack.Navigator screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}>
          <AppStack.Screen name="Home" component={HomeScreen} />
          <AppStack.Screen name="MyTrips" component={MyTripsScreen} />
          <AppStack.Screen name="TripDetail" component={TripDetailScreen} />
          <AppStack.Screen name="CreateTrip" component={CreateTripScreen} />
          <AppStack.Screen name="JoinTrip" component={JoinTripScreen} />
          <AppStack.Screen
            name="ReportExpense"
            component={ReportExpenseScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
          <AppStack.Screen
            name="LiveLocation"
            component={LiveLocationScreen}
            options={{ animation: 'slide_from_right' }}
          />
        </AppStack.Navigator>
      ) : null}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  title: { color: colors.foreground, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  helper: { color: colors.mutedForeground, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  retryButton: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, justifyContent: 'center', marginTop: spacing.sm, minHeight: 52, paddingHorizontal: spacing.xl },
  retryLabel: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
