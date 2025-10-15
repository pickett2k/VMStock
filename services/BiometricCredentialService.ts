import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

interface BiometricCredentials {
  email: string;
  timestamp: number;
  enabled: boolean;
  // Note: We don't store passwords for security reasons
}

export class BiometricCredentialService {
  private static readonly BIOMETRIC_KEY = 'vmstock_biometric_auth';
  private static readonly BIOMETRIC_ENABLED_KEY = 'vmstock_biometric_enabled';

  /**
   * Store user credentials securely for biometric authentication
   */
  static async storeCredentials(email: string): Promise<boolean> {
    try {
      console.log('🔐 Storing biometric credentials for:', email);
      
      const credentials: BiometricCredentials = {
        email: email.toLowerCase().trim(),
        timestamp: Date.now(),
        enabled: true
      };

      await SecureStore.setItemAsync(
        this.BIOMETRIC_KEY,
        JSON.stringify(credentials),
        {
          requireAuthentication: true, // Require biometric auth to access
          authenticationPrompt: 'Authenticate to save your login credentials'
        }
      );

      await SecureStore.setItemAsync(
        this.BIOMETRIC_ENABLED_KEY,
        'true'
      );

      console.log('✅ Biometric credentials stored successfully');
      return true;
    } catch (error) {
      console.error('❌ Error storing biometric credentials:', error);
      return false;
    }
  }

  /**
   * Retrieve stored credentials using biometric authentication
   */
  static async getCredentials(): Promise<BiometricCredentials | null> {
    try {
      console.log('🔐 Retrieving biometric credentials...');
      
      const isEnabled = await this.isBiometricEnabled();
      if (!isEnabled) {
        console.log('🔐 Biometric auth is disabled');
        return null;
      }

      const credentialsJson = await SecureStore.getItemAsync(
        this.BIOMETRIC_KEY,
        {
          requireAuthentication: true,
          authenticationPrompt: 'Use biometric authentication to sign in'
        }
      );

      if (!credentialsJson) {
        console.log('🔐 No biometric credentials found');
        return null;
      }

      const credentials: BiometricCredentials = JSON.parse(credentialsJson);
      
      // Check if credentials are not too old (optional security measure)
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      const isExpired = Date.now() - credentials.timestamp > maxAge;
      
      if (isExpired) {
        console.log('🔐 Biometric credentials expired, clearing...');
        await this.clearCredentials();
        return null;
      }

      console.log('✅ Biometric credentials retrieved successfully');
      return credentials;
    } catch (error) {
      console.error('❌ Error retrieving biometric credentials:', error);
      
      // If the error is due to user cancelling biometric auth, don't log as error
      if (error instanceof Error && error.message.includes('UserCancel')) {
        console.log('👤 User cancelled biometric authentication');
      }
      
      return null;
    }
  }

  /**
   * Get the stored email for biometric authentication
   */
  static async getStoredEmail(): Promise<string | null> {
    try {
      const credentials = await this.getCredentials();
      return credentials?.email || null;
    } catch (error) {
      console.error('❌ Error getting stored email:', error);
      return null;
    }
  }

  /**
   * Check if biometric authentication is enabled for this user
   */
  static async isBiometricEnabled(): Promise<boolean> {
    try {
      const enabled = await SecureStore.getItemAsync(this.BIOMETRIC_ENABLED_KEY);
      return enabled === 'true';
    } catch (error) {
      console.error('❌ Error checking biometric enabled status:', error);
      return false;
    }
  }

  /**
   * Enable or disable biometric authentication
   */
  static async setBiometricEnabled(enabled: boolean): Promise<boolean> {
    try {
      console.log('🔐 Setting biometric auth enabled to:', enabled);
      
      if (enabled) {
        await SecureStore.setItemAsync(this.BIOMETRIC_ENABLED_KEY, 'true');
      } else {
        // If disabling, also clear stored credentials
        await this.clearCredentials();
        await SecureStore.deleteItemAsync(this.BIOMETRIC_ENABLED_KEY);
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error setting biometric enabled status:', error);
      return false;
    }
  }

  /**
   * Clear all stored biometric credentials
   */
  static async clearCredentials(): Promise<boolean> {
    try {
      console.log('🔐 Clearing biometric credentials...');
      
      await SecureStore.deleteItemAsync(this.BIOMETRIC_KEY);
      await SecureStore.deleteItemAsync(this.BIOMETRIC_ENABLED_KEY);
      
      console.log('✅ Biometric credentials cleared');
      return true;
    } catch (error) {
      console.error('❌ Error clearing biometric credentials:', error);
      return false;
    }
  }

  /**
   * Check if biometric credentials exist
   */
  static async hasStoredCredentials(): Promise<boolean> {
    try {
      const credentials = await SecureStore.getItemAsync(this.BIOMETRIC_KEY);
      return credentials !== null;
    } catch (error) {
      console.error('❌ Error checking for stored credentials:', error);
      return false;
    }
  }

  /**
   * Simple hash function for password storage (not cryptographically secure, but adds a layer)
   */
  private static async simpleHash(input: string): Promise<string> {
    // Simple hash for additional security layer
    // In a production app, you might want to use a proper crypto library
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }
}