import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
  biometricType?: string;
}

export class BiometricAuthService {
  /**
   * Check if biometric authentication is available on this device
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      
      console.log('🔐 Biometric availability check:', {
        hasHardware,
        isEnrolled,
        platform: Platform.OS
      });
      
      return hasHardware && isEnrolled;
    } catch (error) {
      console.warn('⚠️ Error checking biometric availability:', error);
      return false;
    }
  }

  /**
   * Get the types of biometric authentication available
   */
  static async getAvailableTypes(): Promise<LocalAuthentication.AuthenticationType[]> {
    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      console.log('🔐 Available biometric types:', types);
      return types;
    } catch (error) {
      console.warn('⚠️ Error getting biometric types:', error);
      return [];
    }
  }

  /**
   * Authenticate using biometrics
   */
  static async authenticate(reason?: string): Promise<BiometricAuthResult> {
    try {
      const isAvailable = await this.isAvailable();
      
      if (!isAvailable) {
        return {
          success: false,
          error: 'Biometric authentication is not available on this device'
        };
      }

      const types = await this.getAvailableTypes();
      const biometricType = this.getBiometricTypeString(types);

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason || `Use ${biometricType} to sign in`,
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use Password',
        disableDeviceFallback: false, // Allow fallback to device passcode
      });

      if (result.success) {
        console.log('✅ Biometric authentication successful');
        return {
          success: true,
          biometricType
        };
      } else {
        console.log('❌ Biometric authentication failed:', result.error);
        return {
          success: false,
          error: result.error || 'Authentication failed',
          biometricType
        };
      }
    } catch (error) {
      console.error('❌ Biometric authentication error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication error'
      };
    }
  }

  /**
   * Get a user-friendly string for the biometric type
   */
  private static getBiometricTypeString(types: LocalAuthentication.AuthenticationType[]): string {
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return Platform.OS === 'ios' ? 'Face ID' : 'Face Recognition';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return 'Iris Scan';
    }
    return 'Biometric';
  }

  /**
   * Check if device has any form of local authentication (including passcode)
   */
  static async hasDeviceAuthentication(): Promise<boolean> {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      return hasHardware;
    } catch (error) {
      console.warn('⚠️ Error checking device authentication:', error);
      return false;
    }
  }
}

export const biometricAuthService = new BiometricAuthService();