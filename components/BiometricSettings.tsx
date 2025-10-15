import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../app/ThemeContext';

interface BiometricSettingsProps {
  containerStyle?: any;
}

export default function BiometricSettings({ containerStyle }: BiometricSettingsProps) {
  const { 
    isBiometricAvailable, 
    isBiometricEnabled, 
    enableBiometricAuth, 
    disableBiometricAuth,
    user 
  } = useAuth();
  const { isDarkMode } = useTheme();

  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    checkBiometricStatus();
  }, []);

  const checkBiometricStatus = async () => {
    try {
      setLoading(true);
      const available = await isBiometricAvailable();
      setIsAvailable(available);
      
      if (available) {
        const enabled = await isBiometricEnabled();
        setIsEnabled(enabled);
      }
    } catch (error) {
      console.error('❌ Error checking biometric status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (value: boolean) => {
    if (!user?.email) {
      Alert.alert('Error', 'Unable to configure biometric authentication. Please sign in again.');
      return;
    }

    setSwitching(true);

    try {
      if (value) {
        // Enabling biometric auth
        const success = await enableBiometricAuth(user.email);
        if (success) {
          setIsEnabled(true);
          Alert.alert(
            'Success', 
            'Biometric authentication has been enabled! You can now use biometric authentication to sign in.'
          );
        } else {
          Alert.alert(
            'Failed', 
            'Could not enable biometric authentication. Please ensure biometric authentication is set up on your device.'
          );
        }
      } else {
        // Disabling biometric auth
        const success = await disableBiometricAuth();
        if (success) {
          setIsEnabled(false);
          Alert.alert('Success', 'Biometric authentication has been disabled.');
        } else {
          Alert.alert('Failed', 'Could not disable biometric authentication.');
        }
      }
    } catch (error: any) {
      console.error('❌ Error toggling biometric auth:', error);
      Alert.alert('Error', error.message || 'An error occurred while configuring biometric authentication.');
    } finally {
      setSwitching(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, containerStyle, isDarkMode && styles.darkContainer]}>
        <ActivityIndicator size="small" color={isDarkMode ? '#fff' : '#007bff'} />
        <Text style={[styles.loadingText, isDarkMode && styles.darkText]}>
          Checking biometric availability...
        </Text>
      </View>
    );
  }

  if (!isAvailable) {
    return (
      <View style={[styles.container, containerStyle, isDarkMode && styles.darkContainer]}>
        <Ionicons 
          name="finger-print-outline" 
          size={24} 
          color={isDarkMode ? '#666' : '#999'} 
        />
        <View style={styles.textContainer}>
          <Text style={[styles.title, styles.disabledText, isDarkMode && styles.darkDisabledText]}>
            Biometric Authentication
          </Text>
          <Text style={[styles.subtitle, styles.disabledText, isDarkMode && styles.darkDisabledText]}>
            Not available on this device
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, containerStyle, isDarkMode && styles.darkContainer]}>
      <Ionicons 
        name="finger-print" 
        size={24} 
        color={isDarkMode ? '#4dabf7' : '#007bff'} 
      />
      <View style={styles.textContainer}>
        <Text style={[styles.title, isDarkMode && styles.darkText]}>
          Biometric Authentication
        </Text>
        <Text style={[styles.subtitle, isDarkMode && styles.darkSubtitle]}>
          {isEnabled ? 'Enabled for faster sign-ins' : 'Use biometrics to sign in quickly'}
        </Text>
      </View>
      <View style={styles.switchContainer}>
        {switching ? (
          <ActivityIndicator size="small" color={isDarkMode ? '#4dabf7' : '#007bff'} />
        ) : (
          <Switch
            value={isEnabled}
            onValueChange={handleToggle}
            trackColor={{ false: '#767577', true: isDarkMode ? '#4dabf7' : '#007bff' }}
            thumbColor={isEnabled ? '#fff' : '#f4f3f4'}
            ios_backgroundColor="#3e3e3e"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  darkContainer: {
    backgroundColor: '#2a2a2a',
    borderColor: '#404040',
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  darkText: {
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  darkSubtitle: {
    color: '#aaa',
  },
  disabledText: {
    color: '#999',
  },
  darkDisabledText: {
    color: '#666',
  },
  switchContainer: {
    marginLeft: 12,
  },
  loadingText: {
    marginLeft: 12,
    fontSize: 14,
    color: '#666',
  },
});