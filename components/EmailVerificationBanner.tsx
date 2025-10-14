import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../app/ThemeContext';

interface EmailVerificationBannerProps {
  visible?: boolean;
  onDismiss?: () => void;
}

export const EmailVerificationBanner: React.FC<EmailVerificationBannerProps> = ({
  visible = true,
  onDismiss
}) => {
  const { user, isEmailVerified, resendEmailVerification, refreshEmailVerificationStatus, logout } = useAuth();
  const { isDarkMode } = useTheme();
  const [isResending, setIsResending] = useState(false);

  // Periodically check for email verification (every 30 seconds)
  useEffect(() => {
    if (!user || isEmailVerified) return;
    
    const interval = setInterval(() => {
      refreshEmailVerificationStatus();
    }, 30000); // Check every 30 seconds
    
    return () => clearInterval(interval);
  }, [user, isEmailVerified, refreshEmailVerificationStatus]);

  if (!visible || !user || isEmailVerified) {
    return null;
  }

  const handleResendVerification = async () => {
    try {
      setIsResending(true);
      await resendEmailVerification();
      Alert.alert(
        'Verification Email Sent',
        'Please check your email for the verification link.',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setIsResending(false);
    }
  };

  const handleRefreshStatus = async () => {
    try {
      const isVerified = await refreshEmailVerificationStatus();
      if (isVerified) {
        Alert.alert(
          'Email Verified!',
          'Your email has been successfully verified.',
          [{ text: 'Great!' }]
        );
      } else {
        Alert.alert(
          'Not Verified Yet',
          'Please check your email and click the verification link.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error refreshing verification status:', error);
      Alert.alert(
        'Error',
        'Unable to check verification status. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out? You can sign back in and verify your email later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          style: 'destructive',
          onPress: () => logout(false) // Safe logout without modal
        }
      ]
    );
  };

  return (
    <View style={[styles.banner, isDarkMode && styles.darkBanner]}>
      <View style={styles.content}>
        <Text style={[styles.title, isDarkMode && styles.darkText]}>
          Email Verification Required
        </Text>
        <Text style={[styles.message, isDarkMode && styles.darkSubText]}>
          Please verify your email address to access all features. Check your inbox for the verification link.
        </Text>
        
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleResendVerification}
            disabled={isResending}
          >
            {isResending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Resend Email</Text>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton, isDarkMode && styles.darkSecondaryButton]}
            onPress={handleRefreshStatus}
          >
            <Text style={[styles.secondaryButtonText, isDarkMode && styles.darkSecondaryButtonText]}>
              I've Verified
            </Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.signOutContainer}>
          <Text style={[styles.helpText, isDarkMode && styles.darkSubText]}>
            Need to use a different email address?
          </Text>
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
          >
            <Text style={[styles.signOutText, isDarkMode && styles.darkSecondaryButtonText]}>
              Sign Out
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {onDismiss && (
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={onDismiss}
        >
          <Text style={[styles.dismissText, isDarkMode && styles.darkSubText]}>×</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffeaa7',
    borderWidth: 1,
    borderRadius: 8,
    margin: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  darkBanner: {
    backgroundColor: '#2d3748',
    borderColor: '#4a5568',
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#856404',
    marginBottom: 4,
  },
  darkText: {
    color: '#f7fafc',
  },
  message: {
    fontSize: 14,
    color: '#856404',
    marginBottom: 12,
    lineHeight: 20,
  },
  darkSubText: {
    color: '#cbd5e0',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    minWidth: 100,
  },
  primaryButton: {
    backgroundColor: '#007bff',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#856404',
  },
  darkSecondaryButton: {
    borderColor: '#cbd5e0',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#856404',
    fontSize: 14,
    fontWeight: '600',
  },
  darkSecondaryButtonText: {
    color: '#cbd5e0',
  },
  dismissButton: {
    padding: 4,
    marginLeft: 8,
  },
  dismissText: {
    fontSize: 20,
    color: '#856404',
    fontWeight: 'bold',
  },
  signOutContainer: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    alignItems: 'center',
  },
  helpText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    textAlign: 'center',
  },
  signOutButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  signOutText: {
    fontSize: 14,
    color: '#dc3545',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});