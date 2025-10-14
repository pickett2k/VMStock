import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { FirebaseAuth } from '../config/firebase';
import JWTPersistenceService from '../services/JWTPersistenceService';

const auth = FirebaseAuth;

/**
 * Utility to verify Firebase Auth AsyncStorage keys are working properly
 * after implementing proper React Native persistence
 */
export const verifyFirebaseAuthKeys = async () => {
  console.log('🔐 Starting Firebase Auth Key Verification...');
  
  try {
    // Get all AsyncStorage keys
    const allKeys = await AsyncStorage.getAllKeys();
    console.log('📱 All AsyncStorage keys:', allKeys.length);
    
    // Look for Firebase auth keys (various possible formats)
    const firebaseAuthKeys = allKeys.filter(key => 
      key.includes('firebase') && (
        key.includes('authUser') || 
        key.includes('auth') ||
        key.includes('user')
      )
    );
    console.log('🔑 Firebase auth keys found:', firebaseAuthKeys);
    
    // Also log any keys that might be Firebase-related
    const possibleFirebaseKeys = allKeys.filter(key => key.toLowerCase().includes('firebase'));
    if (possibleFirebaseKeys.length > 0) {
      console.log('🔍 All Firebase-related keys:', possibleFirebaseKeys);
    }
    
    // Check SecureStore for Firebase Auth persistence keys
    console.log('\n🔐 Checking SecureStore for Firebase Auth keys...');
    const commonFirebaseKeyPatterns = [
      'firebase:authUser',
      'firebaseAuthUser',
      `firebase:authUser:${auth.app.options.apiKey}:[DEFAULT]`,
    ];
    
    for (const keyPattern of commonFirebaseKeyPatterns) {
      try {
        const value = await SecureStore.getItemAsync(keyPattern);
        if (value) {
          console.log(`✅ SecureStore key "${keyPattern}" found:`, value.substring(0, 50) + '...');
        } else {
          console.log(`❌ SecureStore key "${keyPattern}" not found`);
        }
      } catch (error) {
        console.log(`⚠️ Error checking SecureStore key "${keyPattern}":`, error);
      }
    }
    
    // Check current user status
    console.log('\n👤 Current Firebase Auth user status:');
    console.log('👤 Current user:', !!auth.currentUser);
    console.log('👤 User email:', auth.currentUser?.email || 'None');
    console.log('👤 User UID:', auth.currentUser?.uid || 'None');

    // Check SecureStore JWT status
    const hasValidJWT = await JWTPersistenceService.hasValidJWT();
    const jwtUserData = await JWTPersistenceService.getUserData();
    console.log('🔐 SecureStore JWT valid:', hasValidJWT);
    if (jwtUserData) {
      console.log('🔐 SecureStore user data:', jwtUserData.email);
    }
    
    // If user is signed in, verify the key content
    if (auth.currentUser && firebaseAuthKeys.length > 0) {
      for (const key of firebaseAuthKeys) {
        try {
          const value = await AsyncStorage.getItem(key);
          console.log(`🔍 Key "${key}" exists:`, !!value);
          if (value) {
            const parsed = JSON.parse(value);
            console.log(`📄 Key "${key}" contains user:`, !!parsed.uid);
            console.log(`📄 User email in storage:`, parsed.email);
          }
        } catch (error) {
          console.warn(`❌ Error reading key "${key}":`, error);
        }
      }
    }
    
    // Return summary
    return {
      totalKeys: allKeys.length,
      firebaseAuthKeys: firebaseAuthKeys.length,
      hasCurrentUser: !!auth.currentUser,
      userEmail: auth.currentUser?.email,
      keysFound: firebaseAuthKeys,
      secureStoreJWT: hasValidJWT,
      jwtUserData: jwtUserData
    };
    
  } catch (error) {
    console.error('❌ Error verifying Firebase Auth keys:', error);
    return null;
  }
};

/**
 * Test function to run after successful sign-in
 * Call this after signing in to verify persistence is working
 */
export const testFirebaseAuthPersistence = async () => {
  console.log('🧪 Testing Firebase Auth Persistence...');
  
  const beforeSignIn = await verifyFirebaseAuthKeys();
  console.log('📊 Before sign-in state:', beforeSignIn);
  
  return {
    beforeSignIn,
    instructions: [
      '1. Sign in to your app',
      '2. Call verifyFirebaseAuthKeys() again',
      '3. Kill the app completely',
      '4. Restart the app',
      '5. Check if user is still signed in without re-authentication'
    ]
  };
};

/**
 * Quick check function to add to any screen for testing
 */
export const quickAuthCheck = async () => {
  const allKeys = await AsyncStorage.getAllKeys();
  const authKeys = allKeys.filter(k => k.includes('firebase:authUser'));
  
  console.log('🚀 Quick Auth Check:');
  console.log('  Current user:', !!auth.currentUser);
  console.log('  Auth keys in storage:', authKeys.length);
  console.log('  Keys:', authKeys);
  
  return {
    hasUser: !!auth.currentUser,
    keyCount: authKeys.length,
    keys: authKeys
  };
};