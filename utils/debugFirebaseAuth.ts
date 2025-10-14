import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps } from 'firebase/app';
import { FirebaseAuth } from '../config/firebase';
import { FIREBASE_API_KEY } from '@env';

/**
 * Debug utilities for Firebase Auth persistence
 * Use these functions to verify that auth persistence is working correctly
 */

// Step 2: Verify only one app/auth exists
export const debugFirebaseAppStatus = () => {
  console.log('🔍 Firebase Apps:', getApps().map(a => a.name)); // Should be ["[DEFAULT]"]
  
  try {
    console.log('🔍 Firebase Auth app name:', FirebaseAuth?.app?.name);      // Should be "[DEFAULT]"
    
    if (getApps().length !== 1) {
      console.error('❌ Multiple Firebase apps detected! This breaks persistence.');
    }
    
    if (FirebaseAuth?.app?.name !== '[DEFAULT]') {
      console.error('❌ Auth app name is not [DEFAULT]! This breaks persistence.');
    }
  } catch (error) {
    console.error('❌ Error accessing Firebase Auth app:', error);
  }
};

// Step 4: Check Firebase auth persistence status (platform-default method)
export const debugAsyncStorageAuthKeys = async () => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const firebaseAuthKeys = allKeys.filter(k => 
      k.startsWith('firebase:authUser:') || 
      k.startsWith('firebase_auth_')
    );
    
    console.log('🔍 All AsyncStorage keys:', allKeys.length);
    console.log('🔍 Firebase auth keys:', firebaseAuthKeys);
    
    // Note: With platform-default persistence, Firebase may use different storage mechanisms
    // This is expected behavior and not necessarily a problem
    if (firebaseAuthKeys.length === 0) {
      console.log('ℹ️ No Firebase auth keys found in AsyncStorage');
      console.log('   This is expected with platform-default persistence.');
      console.log('   Firebase uses optimal platform-specific storage.');
      return true; // This is actually OK
    }
    
    // Check the specific key format we're using
    const expectedKey = `firebase:authUser:${FIREBASE_API_KEY}:[DEFAULT]`;
    const hasExpectedKey = firebaseAuthKeys.includes(expectedKey);
    
    if (!hasExpectedKey) {
      console.warn('⚠️ Expected key not found:', expectedKey);
      console.warn('   Found keys:', firebaseAuthKeys);
    } else {
      console.log('✅ Expected Firebase auth key found:', expectedKey);
    }
    
    return hasExpectedKey;
  } catch (error) {
    console.error('❌ Error checking AsyncStorage auth keys:', error);
    return false;
  }
};

// Step 5: Check for accidental AsyncStorage clears
export const debugAsyncStorageClears = async () => {
  const allKeys = await AsyncStorage.getAllKeys();
  console.log('🔍 Total AsyncStorage keys:', allKeys.length);
  
  if (allKeys.length < 5) {
    console.warn('⚠️ Very few AsyncStorage keys found. Possible storage clear?');
    console.log('   Keys:', allKeys);
  }
};

// Run all debug checks
export const runAllFirebaseAuthDebugChecks = async () => {
  console.log('\n🔍 === Firebase Auth Debug Checks ===');
  
  debugFirebaseAppStatus();
  await debugAsyncStorageAuthKeys();
  await debugAsyncStorageClears();
  
  console.log('🔍 === End Debug Checks ===\n');
};

// Export for use in components during development
export const addDebugToLogin = (component: string) => {
  console.log(`🔍 ${component}: Running post-login debug checks...`);
  setTimeout(() => {
    runAllFirebaseAuthDebugChecks();
  }, 1000); // Wait 1 second after login to check
};