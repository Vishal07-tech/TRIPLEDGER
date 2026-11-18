const cream = '#FFF7ED';

export default {
  expo: {
    name: 'Sutrula Payanam',
    slug: 'tripledger-mobile',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    icon: './assets/icon.png',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: cream,
    },
    android: {
      package: 'com.tripledger.mobile',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: cream,
      },
      softwareKeyboardLayoutMode: 'pan',
    },
    plugins: [
      'expo-dev-client',
      ['expo-secure-store', { configureAndroidBackup: true }],
      ['expo-splash-screen', { image: './assets/splash.png', imageWidth: 180, backgroundColor: cream }],
    ],
  },
};
