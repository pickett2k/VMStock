import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { 
  User, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithCustomToken
} from 'firebase/auth';
import { FirebaseAuth } from '../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dataMigrationService } from '../services/DataMigrationService';
import { firebaseService } from '../services/FirebaseService';
import { runAllFirebaseAuthDebugChecks, debugFirebaseAppStatus } from '../utils/debugFirebaseAuth';
import { normalizeEmail, validateEmail, getEmailProvider } from '../utils/emailUtils';
import { hybridSyncService } from '../services/HybridSyncService';
import { BiometricAuthService } from '../services/BiometricAuthService';
import { BiometricCredentialService } from '../services/BiometricCredentialService';
import JWTPersistenceService from '../services/JWTPersistenceService';

// Authentication context type
interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  assignedPlayer: any | null; // Player object if user is assigned to one
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  logout: (forceLogout?: boolean) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendEmailVerification: () => Promise<void>;
  refreshEmailVerificationStatus: () => Promise<boolean>;
  isAuthenticated: boolean;
  checkUserRole: () => Promise<void>;
  authInitialized: boolean;
  authReady: boolean;
  isEmailVerified: boolean;
  // Biometric authentication
  isBiometricAvailable: () => Promise<boolean>;
  authenticateWithBiometrics: (reason?: string) => Promise<boolean>;
  // Biometric credential management
  signInWithBiometrics: () => Promise<void>;
  enableBiometricAuth: (email: string) => Promise<boolean>;
  disableBiometricAuth: () => Promise<boolean>;
  isBiometricEnabled: () => Promise<boolean>;
  hasBiometricCredentials: () => Promise<boolean>;
}

// Create context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Auth provider component
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [assignedPlayer, setAssignedPlayer] = useState<any | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);

  // Flag to prevent multiple simultaneous role checks
  const roleCheckInProgress = useRef(false);

  // Check user role and assigned player
  const checkUserRole = useCallback(async () => {
    // Prevent multiple simultaneous executions
    if (roleCheckInProgress.current) {
      console.log('🔍 Role check already in progress, skipping duplicate call');
      return;
    }

    roleCheckInProgress.current = true;
    
    try {
      const currentUser = FirebaseAuth.currentUser || user;
      if (!currentUser) {
        console.log('🔍 No user found, setting admin and owner to false');
        setIsAdmin(false);
        setIsOwner(false);
        setAssignedPlayer(null);
        return;
      }

      // Check if FirebaseService is ready (organization ID is set)
      if (!firebaseService.isReady()) {
        console.log('🔍 FirebaseService not ready (no organization ID set), skipping role check');
        // Set defaults but don't error - role check will be called again when organization is set
        setIsAdmin(false);
        setIsOwner(false);
        setAssignedPlayer(null);
        return;
      }

      // Check if user is an admin (has staff record)
      console.log('🔍 Checking user role for UID:', currentUser.uid);
      console.log('🔍 User email:', currentUser.email);
      const staffUsers = await firebaseService.getStaffUsers();
      console.log('🔍 Found', staffUsers.length, 'staff users');
      console.log('🔍 Staff users:', staffUsers.map(s => ({ uid: s.uid, email: s.email, role: s.role })));
      
      const staffUser = staffUsers.find(staff => staff.uid === currentUser.uid);
      console.log('🔍 Matching staff user:', staffUser);
      
      // Check both role field and permissions for admin status
      const isAdminUser = !!(staffUser?.permissions?.isAdmin || staffUser?.role === 'admin' || staffUser?.role === 'owner');
      const isOwnerUser = !!(staffUser?.role === 'owner');
      console.log('🔍 Setting isAdmin to:', isAdminUser);
      console.log('🔍 Setting isOwner to:', isOwnerUser);
      setIsAdmin(isAdminUser);
      setIsOwner(isOwnerUser);

      // Check if user is assigned to a player
      const players = await firebaseService.getPlayers();
      const assignedPlayerRecord = players.find(player => player.assignedUserId === currentUser.uid);
      setAssignedPlayer(assignedPlayerRecord || null);
    } catch (error) {
      console.error('Error checking user role:', error);
      setIsAdmin(false);
      setIsOwner(false);
      setAssignedPlayer(null);
    } finally {
      roleCheckInProgress.current = false;
    }
  }, [user]); // Only depend on user, not firebaseService which can change

  useEffect(() => {
    // Check for stored JWT token on app startup and restore Firebase Auth
    const checkAndRestoreStoredJWT = async () => {
      try {
        const hasValidJWT = await JWTPersistenceService.hasValidJWT();
        if (hasValidJWT) {
          console.log('🔐 Found valid JWT in SecureStore on startup');
          const userData = await JWTPersistenceService.getUserData();
          const token = await JWTPersistenceService.getJWT();
          
          if (userData && token && !FirebaseAuth.currentUser) {
            console.log('👤 JWT user data:', userData.email);
            console.log('🔄 Attempting to restore Firebase Auth from JWT...');
            
            // Note: Firebase Auth should handle persistence automatically in Expo Go
            // The JWT restoration is primarily for verification and debugging
            console.log('🔍 JWT found - Firebase Auth should restore automatically');
            console.log('📱 In Expo Go - relying on Firebase\'s built-in persistence');
            
            // Don't try to manually restore with signInWithCustomToken as that's for server-generated tokens
            // Let Firebase handle the restoration naturally
          } else if (userData) {
            console.log('� JWT found but Firebase user already authenticated:', userData.email);
          }
        } else {
          console.log('�🔐 No valid JWT found in SecureStore');
        }
      } catch (error) {
        console.warn('⚠️ Error checking/restoring stored JWT:', error);
      }
    };

    checkAndRestoreStoredJWT();

    // ✅ MD file guidance: Let Firebase handle persistence, we don't need custom AsyncStorage auth layer
    console.log('🔍 Setting up Firebase Auth state listener...');

    // Extended fallback timeout (MD file recommendation: don't rush Firebase restoration)
    const initializationTimeout = setTimeout(() => {
      if (!authInitialized) {
        console.warn('⚠️ Firebase Auth initialization timeout after 15s - forcing initialization');
        setAuthInitialized(true);
        setLoading(false);
      }
    }, 15000); // Extended from 3s to 15s to give Firebase more time

    // Debug: Check Firebase app status at startup
    debugFirebaseAppStatus();

    const unsubscribe = onAuthStateChanged(FirebaseAuth, async (user) => {
      console.log('🔄 Auth state changed. User:', user ? `${user.email} (${user.uid})` : 'null');
      
      // Safety check for Firebase Auth instance
      try {
        console.log('🔄 Firebase Auth currentUser:', FirebaseAuth?.currentUser ? `${FirebaseAuth.currentUser.email}` : 'null');
      } catch (error) {
        console.error('🔄 Error accessing Firebase Auth currentUser:', error);
      }
      
      console.log('🔄 Auth initialized:', authInitialized);
      
      setUser(user);
      
      // Bypass email verification for specific admin email
      const shouldBypassVerification = user?.email === 'admin@valemadrid.com';
      setIsEmailVerified(user?.emailVerified || shouldBypassVerification || false);
      
      // Mark auth as initialized and ready on first auth state change (regardless of user state)
      if (!authInitialized) {
        console.log('✅ Firebase Auth initialization complete - user state determined');
        clearTimeout(initializationTimeout);
        setAuthInitialized(true);
        setAuthReady(true);
      }
      
      // Check user role and permissions after setting user
      if (user) {
        console.log('✅ User authenticated successfully:', user.email);
        console.log('🔄 User authenticated, checking role...');
        
        // Debug: Run Firebase Auth persistence checks after successful login
        setTimeout(() => {
          runAllFirebaseAuthDebugChecks();
        }, 2000);
        
        // Use setTimeout to ensure user state is updated first
        setTimeout(async () => {
          await checkUserRole();
        }, 100);
        
        // Save JWT token to SecureStore for enhanced persistence
        try {
          const token = await user.getIdToken();
          const userData = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            emailVerified: user.emailVerified
          };
          await JWTPersistenceService.saveJWT(token, userData);
          console.log('� JWT token saved to SecureStore');
        } catch (error) {
          console.warn('⚠️ Failed to save JWT to SecureStore:', error);
        }

        // Perform data migration on first login
        try {
          const migrationResult = await dataMigrationService.performMigration();
          if (migrationResult.success) {
            console.log('✅ Data migration:', migrationResult.message);
            
            // After successful migration, preload critical data for offline availability
            setTimeout(async () => {
              try {
                console.log('🚀 Preloading critical data for offline use...');
                await hybridSyncService.preloadCriticalData();
                console.log('✅ Critical data preloaded successfully');
              } catch (preloadError) {
                console.warn('⚠️ Critical data preload failed (non-fatal):', preloadError);
              }
            }, 2000); // Delay to let initial migration complete
            
          } else {
            console.error('❌ Migration failed:', migrationResult.message);
          }
        } catch (error) {
          console.error('Migration error:', error);
        }
      } else {
        console.log('❌ User is null - user logged out or not authenticated');
        console.log('🔍 Firebase Auth currentUser when null:', FirebaseAuth?.currentUser?.email || 'undefined');
        
        // Clear all user-specific state
        setIsAdmin(false);
        setIsOwner(false);
        setAssignedPlayer(null);
        
        // CRITICAL: Clear organization context when user logs out to prevent data leakage
        console.log('🧹 Clearing organization context on user logout');
        try {
          // Import the organization context hook if available
          // Note: This should be handled by the organization context itself
          // but we'll add a safety check here
        } catch (error) {
          console.warn('⚠️ Could not clear organization on logout:', error);
        }
      }
      
      // Only set loading to false after auth is initialized
      console.log('✅ Auth state change processing complete, setting loading to false');
      setLoading(false);
    });

    return () => {
      unsubscribe();
      clearTimeout(initializationTimeout);
    };
  }, []);

  // Monitor FirebaseService readiness and trigger role check when organization is loaded
  useEffect(() => {
    if (!user || !authInitialized) return;

    let attempts = 0;
    const maxAttempts = 30; // Check for 15 seconds (30 * 500ms)

    // Check if we need to do a role check when Firebase service becomes ready
    const checkFirebaseServiceReadiness = async () => {
      attempts++;
      const isReady = firebaseService.isReady();
      console.log(`🔍 AuthContext - FirebaseService ready check #${attempts}: ${isReady}`);
      
      if (isReady && (!isAdmin && !isOwner && !assignedPlayer)) {
        console.log('🔍 FirebaseService is now ready, triggering delayed role check');
        clearInterval(checkInterval);
        clearTimeout(timeout);
        await checkUserRole();
      } else if (attempts >= maxAttempts) {
        console.log('⚠️ AuthContext - FirebaseService readiness timeout after 15 seconds');
        clearInterval(checkInterval);
      }
    };

    // Start with more frequent polling (every 500ms)
    const checkInterval = setInterval(checkFirebaseServiceReadiness, 500);
    
    // Clean up after 15 seconds
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
    }, 15000);

    checkFirebaseServiceReadiness();

    return () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
    };
  }, [user, authInitialized, checkUserRole]); // Removed isAdmin, isOwner, assignedPlayer to prevent infinite loops

  const signIn = async (email: string, password: string): Promise<void> => {
    try {
      // Normalize email for consistent login
      const normalizedEmail = normalizeEmail(email);
      console.log('🔐 Signing in with normalized email:', normalizedEmail);
      
      // ✅ MD file guidance: don't set loading here, let onAuthStateChanged handle it
      await signInWithEmailAndPassword(FirebaseAuth, normalizedEmail, password);
    } catch (error: any) {
      let friendlyMessage = 'Unable to sign in. Please try again.';
      
      if (error.code === 'auth/user-not-found') {
        friendlyMessage = 'No account found with this email address.';
      } else if (error.code === 'auth/wrong-password') {
        friendlyMessage = 'Incorrect password. Please check your password and try again.';
      } else if (error.code === 'auth/invalid-email') {
        friendlyMessage = 'Please enter a valid email address.';
      } else if (error.code === 'auth/user-disabled') {
        friendlyMessage = 'This account has been disabled. Please contact support.';
      } else if (error.code === 'auth/too-many-requests') {
        friendlyMessage = 'Too many failed attempts. Please try again later.';
      } else if (error.code === 'auth/network-request-failed') {
        friendlyMessage = 'Network error. Please check your connection and try again.';
      } else if (error.code === 'auth/invalid-credential') {
        friendlyMessage = 'Invalid login credentials. Please check your email and password.';
      }
      
      throw new Error(friendlyMessage);
    }
    // ✅ MD file guidance: don't set loading(false) here, let onAuthStateChanged handle it
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string): Promise<void> => {
    try {
      // Normalize and validate email
      const normalizedEmail = normalizeEmail(email);
      const emailValidation = validateEmail(normalizedEmail);
      
      if (!emailValidation.isValid) {
        throw new Error(emailValidation.error || 'Invalid email address');
      }
      
      console.log('📧 Creating account with normalized email:', normalizedEmail);
      
      // ✅ MD file guidance: don't set loading here, let onAuthStateChanged handle it
      const userCredential = await createUserWithEmailAndPassword(FirebaseAuth, normalizedEmail, password);
      
      const displayName = `${firstName} ${lastName}`;
      
      // Update Firebase Auth profile with display name
      await updateProfile(userCredential.user, {
        displayName: displayName
      });

      // Send email verification with improved deliverability
      try {
        const emailProvider = getEmailProvider(normalizedEmail);
        console.log('📧 Attempting to send email verification to:', userCredential.user.email);
        console.log('📧 Email provider detected:', emailProvider);
        
        // Send email verification with default Firebase settings to avoid domain authorization issues
        await sendEmailVerification(userCredential.user);
        console.log('✅ Email verification sent successfully to:', userCredential.user.email);
        console.log('📧 Check your email (including spam folder) for verification link');
      } catch (verificationError: any) {
        console.error('❌ Failed to send email verification:', verificationError);
        console.error('Error code:', verificationError?.code);
        console.error('Error message:', verificationError?.message);
        // Don't throw here - account creation should still succeed
      }
      
      // Note: Don't create staff user here - they'll be added when they create/join an organization
      console.log('✅ User account created successfully:', userCredential.user.email);
      console.log('📧 User will create staff profile when creating/joining organization');
      
    } catch (error: any) {
      let friendlyMessage = 'Unable to create account. Please try again.';
      
      if (error.code === 'auth/email-already-in-use') {
        friendlyMessage = 'An account with this email already exists. Please sign in instead.';
      } else if (error.code === 'auth/weak-password') {
        friendlyMessage = 'Password is too weak. Please use at least 6 characters.';
      } else if (error.code === 'auth/invalid-email') {
        friendlyMessage = 'Please enter a valid email address.';
      } else if (error.code === 'auth/network-request-failed') {
        friendlyMessage = 'Network error. Please check your connection and try again.';
      }
      
      throw new Error(friendlyMessage);
    }
    // ✅ MD file guidance: don't set loading(false) here, let onAuthStateChanged handle it
  };

  const logout = async (forceLogout: boolean = false): Promise<void> => {
    try {
      console.log('🔐 Starting logout process, force:', forceLogout);
      
      if (forceLogout) {
        // Emergency logout - user has confirmed data loss
        console.warn('🚨 Emergency logout - bypassing sync safety checks');
        await hybridSyncService.emergencyLogout(true);
      } else {
        // Safe logout - sync data first
        console.log('🔐 Safe logout - syncing data first');
        await hybridSyncService.safelyLogoutUser();
        console.log('✅ Safe logout completed - all data synced');
      }
      
      // Clear JWT from SecureStore
      try {
        await JWTPersistenceService.clearJWT();
        console.log('🔐 JWT cleared from SecureStore');
      } catch (error) {
        console.warn('⚠️ Failed to clear JWT from SecureStore:', error);
      }

      // Sign out from Firebase
      await signOut(FirebaseAuth);
    } catch (error: any) {
      console.error('❌ Logout failed:', error);
      throw new Error(error.message || 'Failed to sign out');
    }
    // ✅ MD file guidance: don't set loading(false) here, let onAuthStateChanged handle it
  };

  const resetPassword = async (email: string): Promise<void> => {
    try {
      await sendPasswordResetEmail(FirebaseAuth, email);
    } catch (error: any) {
      let friendlyMessage = 'Unable to send reset email. Please try again.';
      
      if (error.code === 'auth/user-not-found') {
        friendlyMessage = 'No account found with this email address.';
      } else if (error.code === 'auth/invalid-email') {
        friendlyMessage = 'Please enter a valid email address.';
      } else if (error.code === 'auth/network-request-failed') {
        friendlyMessage = 'Network error. Please check your connection and try again.';
      }
      
      throw new Error(friendlyMessage);
    }
  };

  const resendEmailVerification = async (): Promise<void> => {
    try {
      const currentUser = FirebaseAuth.currentUser;
      if (!currentUser) {
        throw new Error('No user is currently signed in.');
      }
      
      if (currentUser.emailVerified) {
        throw new Error('Email is already verified.');
      }
      
      console.log('📧 Attempting to resend email verification to:', currentUser.email);
      
      // Send email verification with default Firebase settings to avoid domain authorization issues
      await sendEmailVerification(currentUser);
      console.log('✅ Email verification resent successfully to:', currentUser.email);
      console.log('📧 Check your email (including spam folder) for verification link');
    } catch (error: any) {
      console.error('❌ Failed to resend email verification:', error);
      console.error('Error code:', error?.code);
      console.error('Error message:', error?.message);
      
      let friendlyMessage = 'Unable to send verification email. Please try again.';
      
      if (error.code === 'auth/too-many-requests') {
        friendlyMessage = 'Too many verification emails sent. Please wait before requesting another.';
      } else if (error.code === 'auth/network-request-failed') {
        friendlyMessage = 'Network error. Please check your connection and try again.';
      }
      
      throw new Error(friendlyMessage);
    }
  };

  const refreshEmailVerificationStatus = async (): Promise<boolean> => {
    try {
      const currentUser = FirebaseAuth.currentUser;
      if (!currentUser) {
        return false;
      }
      
      console.log('🔄 Refreshing email verification status...');
      await currentUser.reload();
      const isVerified = currentUser.emailVerified;
      
      console.log('📧 Email verification status:', isVerified);
      setIsEmailVerified(isVerified);
      
      return isVerified;
    } catch (error: any) {
      console.error('❌ Failed to refresh email verification status:', error);
      return false;
    }
  };

  // Biometric authentication methods
  const isBiometricAvailable = async (): Promise<boolean> => {
    try {
      return await BiometricAuthService.isAvailable();
    } catch (error) {
      console.warn('⚠️ Error checking biometric availability:', error);
      return false;
    }
  };

  const authenticateWithBiometrics = async (reason?: string): Promise<boolean> => {
    try {
      const result = await BiometricAuthService.authenticate(reason);
      return result.success;
    } catch (error) {
      console.warn('⚠️ Biometric authentication error:', error);
      return false;
    }
  };

  // Biometric credential management methods
  const signInWithBiometrics = async (): Promise<void> => {
    try {
      console.log('🔐 Attempting biometric sign-in...');
      
      // Check if biometric auth is available and enabled
      const isAvailable = await BiometricAuthService.isAvailable();
      if (!isAvailable) {
        throw new Error('Biometric authentication is not available on this device');
      }

      const isEnabled = await BiometricCredentialService.isBiometricEnabled();
      if (!isEnabled) {
        throw new Error('Biometric authentication is not enabled');
      }

      // Retrieve stored credentials using biometric auth
      const credentials = await BiometricCredentialService.getCredentials();
      if (!credentials) {
        throw new Error('No biometric credentials found');
      }

      console.log('🔐 Retrieved biometric credentials for:', credentials.email);
      
      // For security reasons, we can't store actual passwords
      // Instead, biometric auth will be used as a "remember me" feature
      // The user will still need to enter their password after biometric verification
      // This throws an error that the LoginScreen can catch and pre-fill the email
      const biometricError = new Error('Biometric authentication successful') as any;
      biometricError.email = credentials.email;
      biometricError.biometricSuccess = true;
      throw biometricError;
      
    } catch (error: any) {
      console.error('❌ Biometric sign-in process:', error);
      throw error; // Re-throw so LoginScreen can handle appropriately
    }
  };

  const enableBiometricAuth = async (email: string): Promise<boolean> => {
    try {
      console.log('🔐 Enabling biometric authentication for:', email);
      
      // First verify that biometric auth is available
      const isAvailable = await BiometricAuthService.isAvailable();
      if (!isAvailable) {
        throw new Error('Biometric authentication is not available on this device');
      }

      // Test biometric authentication first
      const biometricResult = await BiometricAuthService.authenticate(
        'Authenticate to enable biometric sign-in'
      );
      
      if (!biometricResult.success) {
        throw new Error('Biometric authentication failed');
      }

      // Store the email securely (no password stored for security)
      const success = await BiometricCredentialService.storeCredentials(email);
      if (!success) {
        throw new Error('Failed to store biometric credentials');
      }

      console.log('✅ Biometric authentication enabled successfully');
      return true;
    } catch (error: any) {
      console.error('❌ Failed to enable biometric auth:', error);
      return false;
    }
  };

  const disableBiometricAuth = async (): Promise<boolean> => {
    try {
      console.log('🔐 Disabling biometric authentication...');
      
      const success = await BiometricCredentialService.setBiometricEnabled(false);
      if (success) {
        console.log('✅ Biometric authentication disabled');
      }
      
      return success;
    } catch (error: any) {
      console.error('❌ Failed to disable biometric auth:', error);
      return false;
    }
  };

  const isBiometricEnabled = async (): Promise<boolean> => {
    try {
      return await BiometricCredentialService.isBiometricEnabled();
    } catch (error) {
      console.warn('⚠️ Error checking biometric enabled status:', error);
      return false;
    }
  };

  const hasBiometricCredentials = async (): Promise<boolean> => {
    try {
      return await BiometricCredentialService.hasStoredCredentials();
    } catch (error) {
      console.warn('⚠️ Error checking biometric credentials:', error);
      return false;
    }
  };

  const value: AuthContextType = {
    user,
    loading,
    isAdmin,
    isOwner,
    assignedPlayer,
    signIn,
    signUp,
    logout,
    resetPassword,
    resendEmailVerification,
    refreshEmailVerificationStatus,
    checkUserRole,
    isAuthenticated: !!user,
    authInitialized,
    authReady,
    isEmailVerified,
    isBiometricAvailable,
    authenticateWithBiometrics,
    signInWithBiometrics,
    enableBiometricAuth,
    disableBiometricAuth,
    isBiometricEnabled,
    hasBiometricCredentials
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Hook to use auth context
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// ✅ MD file guidance: Firebase persistence handles offline auth, no custom helper needed