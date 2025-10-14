import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Import our providers
import { ThemeProvider } from './app/ThemeContext';
import { OrganizationProvider } from './contexts/OrganizationContext';
import { AuthProvider } from './contexts/AuthContext';

// Import AuthWrapper to handle authentication flow
import AuthWrapper from './components/AuthWrapper';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <OrganizationProvider>
            <AuthWrapper />
          </OrganizationProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

