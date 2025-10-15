import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { FirebaseAuth, JWTPersistenceService } from '../config/firebase';
import { runAllFirebaseAuthDebugChecks } from '../utils/debugFirebaseAuth';
import { verifyFirebaseAuthKeys } from '../utils/verifyFirebaseAuthKeys';

/**
 * MINIMAL REPRO TEST SCREEN
 * 
 * Use this screen to test Firebase Auth persistence in isolation.
 * 
 * Instructions:
 * 1. Add this to your app temporarily (replace a screen or add to navigation)
 * 2. Click "Sign in" 
 * 3. Check the logs for debug output
 * 4. Kill the app completely and relaunch
 * 5. The screen should still show the user's UID if persistence works
 * 
 * If the UID persists → persistence is working ✅
 * If the UID disappears → persistence is broken ❌
 */
export default function FirebaseAuthTest() {
  const [currentUser, setCurrentUser] = useState(FirebaseAuth.currentUser);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = FirebaseAuth.onAuthStateChanged(async (user: User | null) => {
      console.log('🧪 Test Screen - Auth state changed:', user?.uid || 'no user');
      setCurrentUser(user);
      
      // Save JWT tokens when user signs in
      if (user) {
        try {
          await JWTPersistenceService.saveAuthTokens(user);
          console.log('🔐 JWT tokens saved for test user');
        } catch (error) {
          console.error('🔐 Failed to save JWT tokens:', error);
        }
        
        setTimeout(() => {
          runAllFirebaseAuthDebugChecks();
        }, 1000);
      }
    });

    // Initial debug check + JWT persistence test
    setTimeout(async () => {
      runAllFirebaseAuthDebugChecks();
      await testJWTPersistence();
    }, 500);

    return unsubscribe;
  }, []);

  const testJWTPersistence = async () => {
    try {
      console.log('🔐 Testing JWT persistence...');
      const storedAuth = await JWTPersistenceService.getStoredAuthData();
      
      if (storedAuth) {
        console.log('🔐 Found stored auth data:', storedAuth.email);
        const isValid = await JWTPersistenceService.isTokenValid(storedAuth);
        console.log('🔐 Stored token valid:', isValid);
      } else {
        console.log('🔐 No stored auth data found');
      }
    } catch (error) {
      console.error('🔐 JWT persistence test error:', error);
    }
  };

  const handleSignIn = async () => {
    try {
      console.log('🧪 Test Screen - Attempting sign in...');
      const result = await signInWithEmailAndPassword(FirebaseAuth, 'admin@valemadrid.com', 'Scoob666!');
      console.log('🧪 Test Screen - Sign in successful:', result.user.uid);
      Alert.alert('Success', `Signed in as: ${result.user.email}`);
    } catch (error: any) {
      console.error('🧪 Test Screen - Sign in failed:', error);
      Alert.alert('Error', `Sign in failed: ${error.message}`);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(FirebaseAuth);
      Alert.alert('Success', 'Signed out successfully');
    } catch (error: any) {
      Alert.alert('Error', `Sign out failed: ${error.message}`);
    }
  };

  const runDebugChecks = async () => {
    console.log('🧪 Test Screen - Running debug checks...');
    await runAllFirebaseAuthDebugChecks();
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Firebase Auth Persistence Test</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current User:</Text>
        <Text style={styles.userInfo}>
          {currentUser ? `✅ ${currentUser.email} (${currentUser.uid})` : '❌ No user'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test Instructions:</Text>
        <Text style={styles.instructions}>
          1. Click "Sign In" below{'\n'}
          2. Verify user appears above{'\n'}
          3. Check console logs for debug info{'\n'}
          4. Kill app completely (force close){'\n'}
          5. Relaunch app{'\n'}
          6. If user UID still shows → persistence works! ✅{'\n'}
          7. If user disappears → persistence broken ❌
        </Text>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.signInButton]}
          onPress={handleSignIn}
        >
          <Text style={styles.buttonText}>Sign In (Test)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.debugButton]}
          onPress={runDebugChecks}
        >
          <Text style={styles.buttonText}>Run Debug Checks</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.debugButton]}
          onPress={async () => {
            const result = await verifyFirebaseAuthKeys();
            console.log('🔑 AsyncStorage verification result:', result);
            Alert.alert('Key Verification', `Found ${result?.firebaseAuthKeys} Firebase auth keys. Check console for details.`);
          }}
        >
          <Text style={styles.buttonText}>Verify AsyncStorage Keys</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.debugButton]}
          onPress={async () => {
            try {
              const storedAuth = await JWTPersistenceService.getStoredAuthData();
              if (storedAuth) {
                const isValid = await JWTPersistenceService.isTokenValid(storedAuth);
                Alert.alert(
                  'JWT Persistence Test',
                  `Email: ${storedAuth.email}\nUID: ${storedAuth.uid}\nToken Valid: ${isValid}\nSaved: ${new Date(storedAuth.savedAt).toLocaleString()}`
                );
              } else {
                Alert.alert('JWT Persistence Test', 'No stored auth data found');
              }
            } catch (error) {
              Alert.alert('JWT Error', error instanceof Error ? error.message : 'Unknown error');
            }
          }}
        >
          <Text style={styles.buttonText}>Test JWT Persistence</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.signOutButton]}
          onPress={handleSignOut}
        >
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Debug Output:</Text>
        <Text style={styles.instructions}>
          Check the console/logs for detailed debug information.{'\n'}
          Look for Firebase Apps, Auth keys in AsyncStorage, etc.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#333',
  },
  section: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  userInfo: {
    fontSize: 16,
    fontFamily: 'monospace',
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
    color: '#333',
  },
  instructions: {
    fontSize: 14,
    lineHeight: 20,
    color: '#666',
  },
  buttonContainer: {
    gap: 10,
    marginBottom: 20,
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  signInButton: {
    backgroundColor: '#4CAF50',
  },
  debugButton: {
    backgroundColor: '#2196F3',
  },
  signOutButton: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});