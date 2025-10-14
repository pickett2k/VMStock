import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, connectAuthEmulator, Auth } from 'firebase/auth';
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

// Firebase Auth persistence using official getReactNativePersistence
// This uses Firebase's official React Native persistence layer with AsyncStorage

// Initialize Firebase Auth with official React Native persistence
let authInstance: Auth | null = null;

function getAuthInstance(): Auth {
  if (authInstance) return authInstance;
  
  try {
    // For React Native, getAuth() automatically uses AsyncStorage persistence
    // For web, getAuth() uses indexedDB persistence
    authInstance = getAuth(app);
    console.log('🔐 Firebase Auth initialized with platform-default persistence');
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

export const verifyFirebaseAuthKeys = (): void => {
  console.log('🔐 Firebase Auth Verification:');
  console.log('  - App initialized:', !!app);
  console.log('  - Auth instance:', !!FirebaseAuth);
  console.log('  - Auth app reference:', !!FirebaseAuth?.app);
  console.log('  - Current user:', FirebaseAuth?.currentUser?.uid || 'None');
  
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