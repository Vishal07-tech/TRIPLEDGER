import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './auth/AuthContext';
import RootNavigator from './navigation/RootNavigator';

export default function App() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AuthProvider><RootNavigator /></AuthProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
