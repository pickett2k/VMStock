import * as SecureStore from 'expo-secure-store';
import { FirebaseAuth } from '../config/firebase';

/**
 * JWT Persistence Service using Expo SecureStore
 * 
 * This service handles secure storage and retrieval of Firebase JWT tokens
 * using platform-native secure storage (Keychain on iOS, SharedPreferences on Android)
 */
class JWTPersistenceService {
  private static readonly JWT_KEY = 'firebase_jwt_token';
  private static readonly USER_KEY = 'firebase_user_data';
  private static readonly EXPIRY_KEY = 'firebase_token_expiry';

  /**
   * Save Firebase JWT token to secure storage
   */
  public static async saveJWT(token: string, userData: any): Promise<void> {
    try {
      console.log('🔐 SecureStore: Saving JWT token');
      
      // Save the JWT token
      await SecureStore.setItemAsync(this.JWT_KEY, token);
      
      // Save user data
      await SecureStore.setItemAsync(this.USER_KEY, JSON.stringify(userData));
      
      // Calculate expiry (Firebase tokens typically expire in 1 hour)
      const expiryTime = Date.now() + (60 * 60 * 1000); // 1 hour from now
      await SecureStore.setItemAsync(this.EXPIRY_KEY, expiryTime.toString());
      
      console.log('✅ SecureStore: JWT token saved successfully');
    } catch (error) {
      console.error('❌ SecureStore: Failed to save JWT token:', error);
      throw error;
    }
  }

  /**
   * Retrieve JWT token from secure storage
   */
  public static async getJWT(): Promise<string | null> {
    try {
      const token = await SecureStore.getItemAsync(this.JWT_KEY);
      const expiryStr = await SecureStore.getItemAsync(this.EXPIRY_KEY);
      
      if (!token || !expiryStr) {
        console.log('🔐 SecureStore: No JWT token found');
        return null;
      }
      
      const expiry = parseInt(expiryStr);
      if (Date.now() > expiry) {
        console.log('🔐 SecureStore: JWT token expired, clearing');
        await this.clearJWT();
        return null;
      }
      
      console.log('✅ SecureStore: JWT token retrieved successfully');
      return token;
    } catch (error) {
      console.error('❌ SecureStore: Failed to get JWT token:', error);
      return null;
    }
  }

  /**
   * Retrieve user data from secure storage
   */
  public static async getUserData(): Promise<any | null> {
    try {
      const userDataStr = await SecureStore.getItemAsync(this.USER_KEY);
      
      if (!userDataStr) {
        console.log('🔐 SecureStore: No user data found');
        return null;
      }
      
      const userData = JSON.parse(userDataStr);
      console.log('✅ SecureStore: User data retrieved successfully');
      return userData;
    } catch (error) {
      console.error('❌ SecureStore: Failed to get user data:', error);
      return null;
    }
  }

  /**
   * Clear JWT token and user data from secure storage
   */
  public static async clearJWT(): Promise<void> {
    try {
      console.log('🧹 SecureStore: Clearing JWT token and user data');
      
      await SecureStore.deleteItemAsync(this.JWT_KEY);
      await SecureStore.deleteItemAsync(this.USER_KEY);
      await SecureStore.deleteItemAsync(this.EXPIRY_KEY);
      
      console.log('✅ SecureStore: JWT data cleared successfully');
    } catch (error) {
      console.error('❌ SecureStore: Failed to clear JWT data:', error);
      throw error;
    }
  }

  /**
   * Check if a valid JWT token exists
   */
  public static async hasValidJWT(): Promise<boolean> {
    const token = await this.getJWT();
    return token !== null;
  }

  /**
   * Get fresh JWT token from Firebase Auth
   */
  public static async getFreshJWT(): Promise<string | null> {
    try {
      const currentUser = FirebaseAuth.currentUser;
      
      if (!currentUser) {
        console.log('🔐 No Firebase user found for JWT refresh');
        return null;
      }
      
      console.log('🔄 Getting fresh JWT token from Firebase');
      const token = await currentUser.getIdToken(true); // Force refresh
      
      // Save the fresh token
      const userData = {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        emailVerified: currentUser.emailVerified
      };
      
      await this.saveJWT(token, userData);
      return token;
    } catch (error) {
      console.error('❌ Failed to get fresh JWT token:', error);
      return null;
    }
  }

  /**
   * Auto-save JWT token when user signs in
   */
  public static async setupAuthStateListener(): Promise<void> {
    FirebaseAuth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          // User signed in - save their JWT token
          const token = await user.getIdToken();
          const userData = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            emailVerified: user.emailVerified
          };
          
          await this.saveJWT(token, userData);
          console.log('🔐 Auto-saved JWT token for user:', user.email);
        } catch (error) {
          console.error('❌ Failed to auto-save JWT token:', error);
        }
      } else {
        // User signed out - clear stored tokens
        try {
          await this.clearJWT();
          console.log('🔐 Cleared JWT tokens on sign out');
        } catch (error) {
          console.error('❌ Failed to clear JWT tokens:', error);
        }
      }
    });
  }

  /**
   * Initialize authentication from stored JWT
   */
  public static async initializeFromStoredJWT(): Promise<boolean> {
    try {
      console.log('🔐 SecureStore: Checking for stored JWT on app startup');
      
      const token = await this.getJWT();
      const userData = await this.getUserData();
      
      if (!token || !userData) {
        console.log('🔐 No stored JWT found, user needs to sign in');
        return false;
      }
      
      console.log('✅ Found stored JWT, checking if Firebase Auth is already restored');
      console.log('👤 Stored user:', userData.email);
      console.log('👤 Firebase current user:', FirebaseAuth.currentUser?.email || 'None');
      
      // Check if Firebase Auth has already restored the user
      if (FirebaseAuth.currentUser && FirebaseAuth.currentUser.email === userData.email) {
        console.log('✅ Firebase Auth already restored user - no action needed');
        return true;
      }
      
      // Firebase hasn't restored - token might be valid but Firebase needs time
      console.log('⏳ Firebase Auth not restored yet - will rely on auth state listener');
      return true; // We have valid token, let Firebase handle restoration
      
    } catch (error) {
      console.error('❌ Failed to initialize from stored JWT:', error);
      return false;
    }
  }

  /**
   * Validate current JWT token and refresh if needed
   */
  public static async validateAndRefreshToken(): Promise<boolean> {
    try {
      const currentUser = FirebaseAuth.currentUser;
      if (!currentUser) {
        console.log('🔐 No Firebase user - cannot validate token');
        return false;
      }

      // Get fresh token from Firebase
      const token = await currentUser.getIdToken(true); // Force refresh
      
      // Update stored token
      const userData = {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        emailVerified: currentUser.emailVerified
      };
      
      await this.saveJWT(token, userData);
      console.log('✅ Token validated and refreshed');
      return true;
      
    } catch (error) {
      console.error('❌ Token validation failed:', error);
      return false;
    }
  }
}

export default JWTPersistenceService;