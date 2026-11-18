# TripLedger Mobile

Separate Expo/React Native client for the existing TripLedger API. It does not connect to MySQL directly and contains no financial calculation or backend business rules.

## Development setup

1. Copy `.env.example` to `.env` in this directory and set `EXPO_PUBLIC_API_BASE_URL`.
2. Install the repository workspaces from the repository root with `npm install`.
3. Start Metro from the repository root with `npm run start --workspace @tripledger/mobile`.
4. Build and install the development client with `npm run android --workspace @tripledger/mobile` when Android SDK, Android Studio, Java, and an emulator/device are available.

API address examples:

- Android emulator: `http://10.0.2.2:4000` reaches the host computer's loopback API.
- Physical Android device: `http://<development-computer-LAN-IP>:4000`; the device and computer must be on a reachable network, and the firewall must permit the API port.
- Deployed backend: `https://<your-api-host>`.

The public API URL is configuration, not a secret. Never place JWT signing keys, database credentials, or other private credentials in this app. Production traffic must use HTTPS.

The development APK profile is configured in `eas.json`. It requires a development build and produces an internal-install APK; no production signing key is configured. Google Play distribution should use the separately planned production artifact and signing/release process.

The backend issues a seven-day JWT and has no refresh-token endpoint. When `/api/auth/me` returns 401, the mobile session is cleared and the user must sign in again. A network error during startup does not erase a still-stored token; the app shows a retry state.
