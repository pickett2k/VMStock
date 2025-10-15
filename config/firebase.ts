import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, connectAuthEmulator, Auth, indexedDBLocalPersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, Firestore, enableNetwork, disableNetwork } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getAnalytics, Analytics, isSupported } from 'firebase/analytics';
import {
  FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID,
  FIREBASE_MEASUREMENT_ID,
  ENABLE_ANALYTICS,
  ENABLE_FIRESTORE_OFFLINE,
  DEV_MODE,
} from '@env';

// Validate required Firebase configuration
if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID || !FIREBASE_APP_ID) {
  console.error('🔥 Missing required Firebase configuration');
  throw new Error('Firebase configuration is incomplete. Check your environment variables.');
}

// Firebase configuration object
const firebaseConfig = {
  apiKey: FIREBASE_API_KEY,
  authDomain: FIREBASE_AUTH_DOMAIN,
  projectId: FIREBASE_PROJECT_ID,
  storageBucket: FIREBASE_STORAGE_BUCKET,
  messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
  appId: FIREBASE_APP_ID,
  measurementId: FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase app with error handling
let app: FirebaseApp;
try {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
    console.log('🔥 Firebase app initialized successfully');
  } else {
    app = getApps()[0];
    console.log('🔥 Using existing Firebase app instance');
  }
} catch (error) {
  console.error('🔥 Firebase app initialization failed:', error);
  throw new Error('Failed to initialize Firebase app');
}

// SecureStore-based Custom Persistence for Firebase Auth
// Solves TestFlight build persistence issues with device-native secure storage

interface CustomPersistence {
  type: 'LOCAL';
  _get(key: string): Promise<string | null>;
  _set(key: string, value: string): Promise<void>;
  _remove(key: string): Promise<void>;
  _addListener(key: string, listener: () => void): void;
  _removeListener(key: string, listener: () => void): void;
}

class SecureStorePersistence implements CustomPersistence {
  static type = 'LOCAL';
  type = 'LOCAL' as const;

  async _get(key: string): Promise<string | null> {
    try {
      const value = await SecureStore.getItemAsync(key);
      console.log(`🔐 SecureStore _get(${key}):`, value ? 'Found auth data' : 'No auth data');
      return value;
    } catch (error) {
      console.error('🔐 SecureStore get error:', error);
      return null;
    }
  }

  async _set(key: string, value: string): Promise<void> {
    try {
      const options = Platform.OS === 'ios' 
        ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
        : {};
      
      await SecureStore.setItemAsync(key, value, options);
      console.log(`🔐 SecureStore _set(${key}): Auth data saved securely`);
    } catch (error) {
      console.error('🔐 SecureStore set error:', error);
      throw error;
    }
  }

  async _remove(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
      console.log(`🔐 SecureStore _remove(${key}): Auth data cleared`);
    } catch (error) {
      console.error('🔐 SecureStore remove error:', error);
    }
  }

  _addListener(_key: string, _listener: () => void): void {
    // SecureStore doesn't support listeners, but Firebase handles this
  }

  _removeListener(_key: string, _listener: () => void): void {
    // SecureStore doesn't support listeners, but Firebase handles this
  }
}

// JWT Persistence Service for additional reliability
class JWTPersistenceService {
  private static readonly JWT_KEY = 'vmstock_auth_jwt';
  private static readonly USER_KEY = 'vmstock_auth_user';
  private static readonly REFRESH_KEY = 'vmstock_auth_refresh';

  static async saveAuthTokens(user: any): Promise<void> {
    try {
      if (!user) return;

      // Get fresh tokens from Firebase Auth
      const idToken = await user.getIdToken(true);
      const refreshToken = user.refreshToken;
      
      const authData = {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.displayName,
        idToken,
        refreshToken,
        savedAt: Date.now()
      };

      // Save to SecureStore (primary)
      await SecureStore.setItemAsync(this.JWT_KEY, JSON.stringify(authData));
      
      // Save to AsyncStorage (fallback)
      await AsyncStorage.setItem(this.USER_KEY, JSON.stringify({
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.displayName,
        savedAt: Date.now()
      }));

      console.log('🔐 JWT: Auth tokens saved to SecureStore + AsyncStorage');
    } catch (error) {
      console.error('🔐 JWT: Failed to save auth tokens:', error);
    }
  }

  static async getStoredAuthData(): Promise<any> {
    try {
      // Try SecureStore first (most secure)
      const secureData = await SecureStore.getItemAsync(this.JWT_KEY);
      if (secureData) {
        const parsed = JSON.parse(secureData);
        console.log('🔐 JWT: Found auth data in SecureStore');
        return parsed;
      }

      // Fallback to AsyncStorage
      const fallbackData = await AsyncStorage.getItem(this.USER_KEY);
      if (fallbackData) {
        const parsed = JSON.parse(fallbackData);
        console.log('🔐 JWT: Found fallback auth data in AsyncStorage');
        return parsed;
      }

      console.log('🔐 JWT: No stored auth data found');
      return null;
    } catch (error) {
      console.error('🔐 JWT: Error reading stored auth data:', error);
      return null;
    }
  }

  static async clearStoredAuth(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(this.JWT_KEY);
      await AsyncStorage.removeItem(this.USER_KEY);
      await AsyncStorage.removeItem(this.REFRESH_KEY);
      console.log('🔐 JWT: All stored auth data cleared');
    } catch (error) {
      console.error('🔐 JWT: Error clearing stored auth data:', error);
    }
  }

  static async isTokenValid(authData: any): Promise<boolean> {
    if (!authData || !authData.idToken) return false;
    
    try {
      // Simple token expiry check (JWT tokens expire after 1 hour)
      const tokenAge = Date.now() - (authData.savedAt || 0);
      const oneHour = 60 * 60 * 1000;
      
      if (tokenAge > oneHour) {
        console.log('🔐 JWT: Token expired, needs refresh');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('🔐 JWT: Token validation error:', error);
      return false;
    }
  }
}

// Initialize Firebase Auth with hybrid SecureStore + JWT persistence
let authInstance: Auth | null = null;

function getAuthInstance(): Auth {
  if (authInstance) return authInstance;
  
  try {
    if (Platform.OS === 'web') {
      // Web: Use IndexedDB persistence
      authInstance = initializeAuth(app, {
        persistence: indexedDBLocalPersistence,
      });
      console.log('🔐 Web: Firebase Auth initialized with IndexedDB persistence');
    } else {
      // React Native: Use custom SecureStore persistence
      const secureStorePersistence = new SecureStorePersistence();
      authInstance = initializeAuth(app, {
        persistence: secureStorePersistence as any,
      });
      console.log('🔐 React Native: Firebase Auth initialized with SecureStore persistence');
    }
  } catch (error) {
    console.error('🔐 Fatal: Could not initialize Firebase Auth:', error);
    throw new Error('Failed to initialize Firebase Auth');
  }
  
  if (!authInstance) {
    throw new Error('Firebase Auth instance is null');
  }
  
  return authInstance;
}

// Initialize Auth instance
export const FirebaseAuth: Auth = getAuthInstance();

// Export JWT Persistence Service for use in AuthContext
export { JWTPersistenceService };

// Initialize Firestore
export const FirebaseFirestore: Firestore = getFirestore(app);

// Initialize Firebase Storage
export const FirebaseStorage = getStorage(app);

// Initialize Analytics only if supported and enabled
export let FirebaseAnalytics: Analytics | null = null;
if (ENABLE_ANALYTICS === 'true') {
  isSupported().then((supported) => {
    if (supported) {
      FirebaseAnalytics = getAnalytics(app);
    } else {
      console.log('Firebase Analytics not supported in this environment');
    }
  }).catch((error) => {
    console.log('Firebase Analytics initialization failed:', error.message);
  });
}

// Development mode configuration
if (DEV_MODE === 'true' && __DEV__) {
  console.log('Firebase initialized in development mode');
  // Note: Emulators are typically used during development
  // You can uncomment these if you're running Firebase emulators:
  
  // connectAuthEmulator(FirebaseAuth, 'http://localhost:9099');
  // connectFirestoreEmulator(FirebaseFirestore, 'localhost', 8080);
}

// Helper functions
export const isFirebaseConfigured = (): boolean => {
  return !!(
    FIREBASE_API_KEY &&
    FIREBASE_AUTH_DOMAIN &&
    FIREBASE_PROJECT_ID &&
    FIREBASE_STORAGE_BUCKET &&
    FIREBASE_MESSAGING_SENDER_ID &&
    FIREBASE_APP_ID
  );
};

export const verifyFirebaseAuthKeys = async (): Promise<void> => {
  console.log('🔐 Firebase Auth Verification:');
  console.log('  - App initialized:', !!app);
  console.log('  - Auth instance:', !!FirebaseAuth);
  console.log('  - Auth app reference:', !!FirebaseAuth?.app);
  console.log('  - Current user:', FirebaseAuth?.currentUser?.uid || 'None');
  console.log('  - Platform:', Platform.OS);
  console.log('  - Persistence type:', Platform.OS === 'web' ? 'IndexedDB' : 'SecureStore');
  
  // Check stored auth data
  const storedAuth = await JWTPersistenceService.getStoredAuthData();
  console.log('  - Stored auth data:', storedAuth ? 'Found' : 'None');
  
  if (storedAuth) {
    const isValid = await JWTPersistenceService.isTokenValid(storedAuth);
    console.log('  - Stored token valid:', isValid);
  }
  
  if (!FirebaseAuth?.app) {
    console.error('🔐 Auth instance missing app reference - this may cause the TypeError');
  }
};

// Offline network management for Firestore
export const enableFirestoreNetwork = async (): Promise<void> => {
  try {
    await enableNetwork(FirebaseFirestore);
  } catch (error) {
    console.warn('Failed to enable Firestore network:', error);
  }
};

export const disableFirestoreNetwork = async (): Promise<void> => {
  try {
    await disableNetwork(FirebaseFirestore);
  } catch (error) {
    console.warn('Failed to disable Firestore network:', error);
  }
};

// Analytics helper (for web only)
export const logAnalyticsEvent = async (eventName: string, parameters?: { [key: string]: any }) => {
  if (FirebaseAnalytics && ENABLE_ANALYTICS === 'true') {
    try {
      // Analytics logEvent is different in Firebase v9+
      console.log('Analytics event:', eventName, parameters);
      // Note: Analytics in Expo requires web platform for proper logging
    } catch (error) {
      console.warn('Analytics event logging failed:', error);
    }
  }
};

// Error logging helper
export const logError = (error: Error, context?: string) => {
  // For Expo, we'll use console logging and can integrate with Sentry later
  const message = context ? `${context}: ${error.message}` : error.message;
  console.error(message, error);
  
  // Future: Integrate with Expo's error reporting or Sentry
  // if (__DEV__) {
  //   console.error('Development error:', error);
  // }
};

// Export Firebase instances
export default {
  app,
  auth: FirebaseAuth,
  firestore: FirebaseFirestore,
  storage: FirebaseStorage,
  analytics: FirebaseAnalytics,
};