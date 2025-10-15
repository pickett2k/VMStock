import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { useTheme } from '../app/ThemeContext';
import LoginScreen from '../screens/LoginScreen';
import OrganizationSetupScreen from '../screens/OrganizationSetupScreen';
import SyncingScreen from './SyncingScreen';
import AppNavigator from './AppNavigator';
import { EmailVerificationBanner } from './EmailVerificationBanner';

export default function AuthWrapper() {
  const { isAuthenticated, loading: authLoading, user, logout, authInitialized, isEmailVerified } = useAuth();
  const { isSetupComplete, loading: orgLoading, hasCheckedExistingUser, checkExistingUserOrganization } = useOrganization();
  const { isDarkMode } = useTheme();
  const [isSyncComplete, setIsSyncComplete] = useState(false);

  // Debug logging to understand the state
  console.log('🔍 AuthWrapper State:', {
    isAuthenticated,
    authLoading,
    authInitialized,
    orgLoading,
    isSetupComplete,
    hasCheckedExistingUser,
    isSyncComplete,
    userUid: user?.uid
  });

  // Check for existing user organization after authentication
  useEffect(() => {
    if (isAuthenticated && user && !hasCheckedExistingUser && !orgLoading) {
      console.log('🔍 AuthWrapper - Triggering checkExistingUserOrganization');
      checkExistingUserOrganization();
    }
  }, [isAuthenticated, user, hasCheckedExistingUser, orgLoading, checkExistingUserOrganization]);

  // Reset sync status when authentication changes
  useEffect(() => {
    if (!isAuthenticated) {
      setIsSyncComplete(false);
    }
  }, [isAuthenticated]);

  // Show loading spinner while Firebase Auth is initializing or checking auth state
  // CRITICAL: Wait for authInitialized to prevent premature login screen show
  // CRITICAL: Also wait for organization loading to complete to prevent race conditions
  if (!authInitialized || authLoading || orgLoading) {
    return (
      <View style={[styles.loadingContainer, isDarkMode && styles.darkLoadingContainer]}>
        <ActivityIndicator size="large" color={isDarkMode ? '#fff' : '#007bff'} />
        <Text style={[styles.loadingText, isDarkMode && styles.darkLoadingText]}>
          {orgLoading ? 'Loading organization...' : !authInitialized ? 'Initializing auth...' : 'Please wait...'}
        </Text>
        <Text style={[styles.subText, isDarkMode && styles.darkSubText]}>
          {orgLoading ? 'Setting up Firebase connections...' : !authInitialized ? 'Restoring your session...' : 'Almost ready...'}
        </Text>
      </View>
    );
  }

  // Show login screen if not authenticated (only after auth is initialized)
  if (!isAuthenticated) {
    console.log('🔐 AuthWrapper - Showing LoginScreen (auth initialized, no user found)');
    return <LoginScreen />;
  }

  // Check email verification for authenticated users (except existing Vale Madrid staff)
  if (isAuthenticated && !isEmailVerified) {
    console.log('📧 AuthWrapper - Email verification required');
    return (
      <View style={[styles.loadingContainer, isDarkMode && styles.darkLoadingContainer, { padding: 20 }]}>
        <EmailVerificationBanner />
        <Text style={{ textAlign: 'center', marginTop: 20, color: isDarkMode ? '#ccc' : '#666', fontSize: 16 }}>
          Please verify your email address to continue setting up your account.
        </Text>
      </View>
    );
  }

  // Show loading while checking for existing user organization
  // This prevents the flash of organization setup page
  if (isAuthenticated && !hasCheckedExistingUser) {
    return (
      <View style={[styles.loadingContainer, isDarkMode && styles.darkLoadingContainer]}>
        <ActivityIndicator size="large" color={isDarkMode ? '#fff' : '#007bff'} />
        <Text style={[styles.loadingText, isDarkMode && styles.darkLoadingText]}>
          Please wait while we check your organization...
        </Text>
      </View>
    );
  }

  // Show organization setup if not completed (and we've already checked existing users)
  // CRITICAL: Only show org setup after we've confirmed the user doesn't have an organization
  if (isAuthenticated && hasCheckedExistingUser && !isSetupComplete) {
    console.log('🏢 AuthWrapper - Showing OrganizationSetupScreen (user needs org)');
    return <OrganizationSetupScreen />;
  }

  // Show syncing screen if authenticated and setup complete but sync not finished
  if (isAuthenticated && isSetupComplete && !isSyncComplete) {
    console.log('🔄 AuthWrapper - Showing SyncingScreen. Auth:', isAuthenticated, 'Setup:', isSetupComplete, 'Sync:', isSyncComplete);
    return (
      <SyncingScreen 
        onSyncComplete={() => setIsSyncComplete(true)}
        onSyncFailed={() => logout(false)} // Safe logout without modal on sync failure
      />
    );
  }

  // Show your existing app if authenticated, organization is set up, and sync is complete
  console.log('🏠 AuthWrapper - Showing AppNavigator. Auth:', isAuthenticated, 'Setup:', isSetupComplete, 'Sync:', isSyncComplete);
  return <AppNavigator />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  darkLoadingContainer: {
    backgroundColor: '#1a1a1a',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  darkLoadingText: {
    color: '#ccc',
  },
  subText: {
    marginTop: 8,
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  darkSubText: {
    color: '#aaa',
  },
});