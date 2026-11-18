import * as SecureStore from 'expo-secure-store';

const onboardingKey = 'sutrula.onboarding.v1';

/**
 * True when this device has already been through the welcome tour. If secure
 * storage is unavailable we prefer to skip the tour rather than block the app.
 */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(onboardingKey)) === 'seen';
  } catch {
    return true;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(onboardingKey, 'seen');
  } catch {
    // A failed write only means the tour is offered again next launch.
  }
}
