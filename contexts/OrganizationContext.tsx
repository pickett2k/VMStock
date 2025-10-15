import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseAuth, FirebaseFirestore } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseService } from '../services/FirebaseService';
import { hybridSyncService } from '../services/HybridSyncService';

interface ChargeReason {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
}

interface Organization {
  id: string;
  name: string;
  displayName: string;
  type: 'tuck-shop' | 'canteen' | 'cafe' | 'store';
  currency: string;
  shopPin?: string;
  logoUrl?: string; // Firebase Storage URL for organization logo
  settings: {
    allowNegativeBalance?: boolean;
    requireParentEmail?: boolean;
    autoSyncInterval: number;
    chargeReasons?: ChargeReason[];
    features?: {
      enableBarcodeScan?: boolean;
      enablePushNotifications?: boolean;
      enableOfflineMode?: boolean;
      enableAdvancedReports?: boolean;
      enableStripePayments?: boolean;
    };
  };
}

interface OrganizationContextType {
  organization: Organization | null;
  isSetupComplete: boolean;
  loading: boolean;
  hasCheckedExistingUser: boolean;
  createOrganization: (orgData: Partial<Organization>) => Promise<void>;
  updateOrganization: (updates: Partial<Organization>) => Promise<void>;
  clearOrganization: () => Promise<void>;
  checkExistingUserOrganization: () => Promise<void>;
  refreshOrganization: (forceFromServer?: boolean) => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export const useOrganization = () => {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
};

const STORAGE_KEY = '@organization_data';

interface OrganizationProviderProps {
  children: ReactNode;
}

export const OrganizationProvider: React.FC<OrganizationProviderProps> = ({ children }) => {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [hasCheckedExistingUser, setHasCheckedExistingUser] = useState(false);

  useEffect(() => {
    loadOrganization();
  }, []);

  // Listen for auth state changes to refresh organization data when user logs in
  const [hasRefreshedAfterLogin, setHasRefreshedAfterLogin] = useState(false);
  
  useEffect(() => {
    const unsubscribe = FirebaseAuth.onAuthStateChanged(async (user) => {
      if (user && organization && !hasRefreshedAfterLogin && !loading) {
        console.log('👤 OrganizationContext - User logged in, force refreshing organization data from Firebase server');
        setHasRefreshedAfterLogin(true); // Prevent multiple refreshes
        
        // Delay to allow other auth processing to complete
        setTimeout(() => {
          refreshOrganization(true); // Force from server on login
        }, 1000);
      } else if (!user) {
        // Reset flag when user logs out to ensure next user gets fresh data
        console.log('🔓 User logged out - resetting organization refresh flag');
        setHasRefreshedAfterLogin(false);
      }
    });

    return unsubscribe;
  }, [organization, hasRefreshedAfterLogin, loading]); // Include all dependencies

  const loadOrganization = async () => {
    try {
      console.log('🔍 OrganizationContext - Starting organization load from cache...');
      const storedData = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedData) {
        const orgData = JSON.parse(storedData);
        console.log('🔍 OrganizationContext - Loaded organization from cache:', { id: orgData.id, name: orgData.name });
        setOrganization(orgData);
        setIsSetupComplete(true);
        
        // CRITICAL: Set organization ID in FirebaseService when loading from cache
        if (orgData.id) {
          firebaseService.setOrganizationId(orgData.id);
          console.log('🔧 OrganizationContext - Set FirebaseService organization ID:', orgData.id);
          
          // CRITICAL: Give a moment for FirebaseService to register the organization
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Verify FirebaseService is ready
          const isReady = firebaseService.isReady();
          console.log('✅ FirebaseService readiness after organization load:', isReady);
        } else {
          console.error('❌ OrganizationContext - Organization has no ID:', orgData);
        }
        
        // If organization is already loaded, we've effectively "checked" for existing users
        setHasCheckedExistingUser(true);
        console.log('✅ OrganizationContext - Loaded existing organization, marking user check as complete');
      } else {
        console.log('🔍 OrganizationContext - No stored organization found');
      }
      // Note: If no stored organization, AuthWrapper will trigger checkExistingUserOrganization
    } catch (error) {
      console.error('❌ Error loading organization data:', error);
    } finally {
      setLoading(false);
      console.log('✅ OrganizationContext - Organization loading complete, setting loading to false');
    }
  };

  const createOrganization = async (orgData: Partial<Organization>): Promise<void> => {
    try {
      // Generate organization ID from name
      const id = orgData.name?.toLowerCase()
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '-') || 'default-org';

      // Generate shop PIN if not provided
      const shopPin = orgData.shopPin || Math.floor(100000 + Math.random() * 900000).toString();

      const organization: Organization = {
        id,
        name: orgData.name || 'My Organization',
        displayName: orgData.displayName || orgData.name || 'My Organization',
        type: orgData.type || 'tuck-shop',
        currency: orgData.currency || 'USD',
        shopPin,
        settings: {
          allowNegativeBalance: orgData.settings?.allowNegativeBalance ?? true,
          requireParentEmail: orgData.settings?.requireParentEmail ?? false,
          autoSyncInterval: orgData.settings?.autoSyncInterval ?? 300000, // 5 minutes
          ...orgData.settings
        }
      };

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(organization));
      setOrganization(organization);
      // CRITICAL: Set organization ID in FirebaseService when creating new organization
      firebaseService.setOrganizationId(organization.id);
      console.log('🔧 OrganizationContext - Set FirebaseService organization ID for new org:', organization.id);
      setIsSetupComplete(true);
    } catch (error) {
      console.error('Error creating organization:', error);
      throw error;
    }
  };

  const updateOrganization = async (updates: Partial<Organization>): Promise<void> => {
    if (!organization) return;

    try {
      console.log('🏢 OrganizationContext - Updating organization through HybridSyncService');
      
      // Use HybridSyncService for proper offline-first updates with overlays and deltas
      await hybridSyncService.createOrganizationUpdateBundle(updates);
      
      // Update local state optimistically with the merged changes
      const updatedOrg = { ...organization, ...updates };
      setOrganization(updatedOrg);
      // CRITICAL: Update FirebaseService organization ID if it changed
      if (updates.id && updates.id !== organization.id) {
        firebaseService.setOrganizationId(updatedOrg.id);
        console.log('🔧 OrganizationContext - Updated FirebaseService organization ID during update:', updatedOrg.id);
      }
      
      // Also update AsyncStorage for immediate context persistence
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedOrg));
      
      console.log('✅ Organization updated through offline-first architecture');
    } catch (error) {
      console.error('❌ Error updating organization through HybridSyncService:', error);
      throw error;
    }
  };

  const clearOrganization = async (): Promise<void> => {
    try {
      console.log('🧹 OrganizationContext - Clearing organization and ALL cached data');
      
      // Clear organization-specific cache through HybridSyncService
      if (organization?.id) {
        console.log('🧹 Clearing HybridSyncService cache for organization switch');
        await hybridSyncService.clearSyncQueue();
        await hybridSyncService.clearAllStuckData();
        await hybridSyncService.clearPendingBundles();
        
        // ✅ NEW: Clear collection data to prevent cross-org contamination
        const collections = ['products', 'players', 'assignments', 'staff-users', 'charges', 'organizations'];
        for (const collection of collections) {
          await AsyncStorage.removeItem(collection);
          console.log(`🧹 Cleared ${collection} collection data`);
        }
        
        // Clear organization-specific cached initialization markers
        const currentUser = FirebaseAuth.currentUser;
        const userKey = currentUser?.uid || 'anonymous';
        for (const collection of collections) {
          await AsyncStorage.removeItem(`cache_initialized_${collection}_${userKey}`);
          await AsyncStorage.removeItem(`last_sync_${collection}`);
        }
        
        // Clear any provisional organization overlays
        await hybridSyncService.clearProvisionalOverlays('organizations');
        console.log('🧹 Cleared provisional organization overlays');
        
        console.log('✅ All HybridSyncService caches and collection data cleared to prevent cross-org contamination');
      }
      
      // Clear organization context
      await AsyncStorage.removeItem(STORAGE_KEY);
      setOrganization(null);
      setIsSetupComplete(false);
      
      console.log('✅ Organization and ALL associated cache cleared - no cross-contamination');
    } catch (error) {
      console.error('❌ Error clearing organization:', error);
      throw error;
    }
  };

  const checkExistingUserOrganization = async (): Promise<void> => {
    try {
      console.log('🔍 OrganizationContext - Starting checkExistingUserOrganization');
      const currentUser = FirebaseAuth.currentUser;
      if (!currentUser) {
        console.log('🔍 OrganizationContext - No current user, setting hasCheckedExistingUser to true');
        setHasCheckedExistingUser(true);
        return;
      }

      // DON'T set hasCheckedExistingUser yet - wait until we have a definitive answer
      console.log('🔍 OrganizationContext - Checking user organization status...');

      // Set organization ID for vale-madrid-tuck-shop to check existing users
      firebaseService.setOrganizationId('vale-madrid-tuck-shop');
      
      // Check if user is an existing admin with vale-madrid-tuck-shop
      const staffUsers = await firebaseService.getStaffUsers();
      const userStaffRecord = staffUsers.find(staff => 
        staff.uid === currentUser.uid || staff.email === currentUser.email
      );

      if (userStaffRecord && userStaffRecord.organizationId === 'vale-madrid-tuck-shop') {
        // Auto-create organization for existing Vale Madrid users
        const valeOrganization: Organization = {
          id: 'vale-madrid-tuck-shop',
          name: 'Vale Madrid Tuck Shop',
          displayName: 'Vale Madrid Tuck Shop',
          type: 'tuck-shop',
          currency: 'GBP',
          settings: {
            allowNegativeBalance: true,
            requireParentEmail: false,
            autoSyncInterval: 300000
          }
        };

        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(valeOrganization));
        setOrganization(valeOrganization);
        // CRITICAL: Set organization ID in FirebaseService for Vale Madrid auto-setup
        firebaseService.setOrganizationId(valeOrganization.id);
        console.log('🔧 OrganizationContext - Set FirebaseService organization ID for Vale Madrid auto-setup:', valeOrganization.id);
        setIsSetupComplete(true);
        
        console.log('✅ Auto-setup organization for existing Vale Madrid user');
        setHasCheckedExistingUser(true); // Mark as checked after finding organization
      } else {
        // If user exists but doesn't have an organization, mark as needing setup
        // This will allow new users to see the organization setup screen
        console.log('User does not have existing organization - setup required');
        setHasCheckedExistingUser(true); // Mark as checked after confirming no organization
      }
    } catch (error) {
      console.error('Error checking existing user organization:', error);
      setHasCheckedExistingUser(true);
    }
  };

  const refreshOrganization = async (forceFromServer?: boolean) => {
    if (!organization) return;
    
    try {
      setLoading(true);
      console.log('🔄 OrganizationContext - Refreshing organization from Firebase and overlays', { forceFromServer });
      
      // If forcing from server, clear organization cache and get fresh data directly from Firebase
      if (forceFromServer) {
        console.log('💪 Force server refresh - bypassing local cache for organization settings');
        try {
          // Clear only organization-specific cache
          await AsyncStorage.removeItem('organizations');
          console.log('🧹 Cleared organizations collection from local cache');
          
          // Clear any provisional overlays for organizations
          await hybridSyncService.clearProvisionalOverlays('organizations');
          console.log('🧹 Cleared provisional organization overlays');
        } catch (clearError) {
          console.warn('⚠️ Could not clear local cache, continuing with force refresh:', clearError);
        }
      }
      
      // ENHANCED: Fetch fresh data from Firebase first, then apply provisional overlays
      try {
        // Ensure FirebaseService is set to correct organization before any queries
        firebaseService.setOrganizationId(organization.id);
        console.log('🔧 OrganizationContext - Set FirebaseService organization ID for refresh:', organization.id);
        
        // Double-check that we're not accidentally querying wrong organization
        if (organization.id !== 'vale-madrid-tuck-shop') {
          console.warn('⚠️ Organization refresh for non-Vale Madrid org:', organization.id);
        }
        
        // Try to get fresh organization data from Firebase (base + settings)
        const orgDocRef = doc(FirebaseFirestore, 'organizations', organization.id);
        const orgDoc = await getDoc(orgDocRef);
        if (orgDoc.exists()) {
          let firebaseOrgData = { id: orgDoc.id, ...orgDoc.data() } as any;
          console.log('✅ Fetched base organization data from Firebase:', firebaseOrgData.displayName || firebaseOrgData.name);
          
          // CRITICAL: Also fetch organization settings from orgSettings subcollection
          try {
            const orgSettingsRef = doc(FirebaseFirestore, 'organizations', organization.id, 'orgSettings', 'settings');
            const orgSettingsDoc = await getDoc(orgSettingsRef);
            if (orgSettingsDoc.exists()) {
              const settingsData = orgSettingsDoc.data();
              console.log('✅ Found organization settings in Firebase:', { 
                logoUrl: settingsData.logoUrl || 'none',
                shopPin: settingsData.shopPin || 'none',
                currency: settingsData.currency || 'none'
              });
              
              // Merge settings into organization data
              firebaseOrgData = {
                ...firebaseOrgData,
                ...settingsData,
                settings: {
                  ...firebaseOrgData.settings,
                  ...settingsData.settings
                }
              };
              console.log('🔀 Merged organization with settings data');
            } else {
              console.warn('⚠️ No organization settings found in Firebase orgSettings subcollection');
            }
          } catch (settingsError) {
            console.warn('⚠️ Could not fetch organization settings:', settingsError);
          }
          
          // If forcing from server, use Firebase data directly and skip HybridSyncService cache
          if (forceFromServer) {
            console.log('💪 Force server refresh - using complete Firebase data (org + settings)');
            console.log('🔍 Final org data - Logo:', firebaseOrgData.logoUrl || 'none', 'PIN:', firebaseOrgData.shopPin || 'none');
            setOrganization(firebaseOrgData);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(firebaseOrgData));
            
            // Also update the HybridSyncService cache with fresh server data
            await AsyncStorage.setItem('organizations', JSON.stringify([firebaseOrgData]));
            console.log('✅ Organization force refreshed with complete Firebase data (including settings)');
            return;
          }
          
          // Apply provisional overlays on top of fresh Firebase data
          const freshOrgData = await hybridSyncService.getOrganizationWithOverlay();
          const finalOrgData = freshOrgData && freshOrgData._provisional 
            ? freshOrgData  // Use overlaid data if provisional changes exist
            : firebaseOrgData; // Use fresh Firebase data if no provisional changes
          
          setOrganization(finalOrgData);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(finalOrgData));
          console.log('✅ Organization refreshed with complete Firebase data');
          return;
        }
      } catch (firebaseError) {
        console.warn('⚠️ Could not fetch from Firebase, using cache + overlays:', firebaseError);
      }
      
      // Fallback: Use cached data with provisional overlays
      const cachedOrgData = await hybridSyncService.getOrganizationWithOverlay();
      if (cachedOrgData) {
        console.log('✅ Refreshed organization data from cache + provisional overlays');
        setOrganization(cachedOrgData);
        firebaseService.setOrganizationId(cachedOrgData.id);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedOrgData));
      } else {
        // Final fallback to existing organization check
        console.log('📄 No cached data, falling back to organization check');
        await checkExistingUserOrganization();
      }
    } catch (error) {
      console.error('❌ Error refreshing organization:', error);
      // Fallback to existing organization check on error
      try {
        await checkExistingUserOrganization();
      } catch (fallbackError) {
        console.error('❌ Fallback organization check also failed:', fallbackError);
      }
    } finally {
      setLoading(false);
    }
  };

  const value: OrganizationContextType = {
    organization,
    isSetupComplete,
    loading,
    hasCheckedExistingUser,
    createOrganization,
    updateOrganization,
    clearOrganization,
    checkExistingUserOrganization,
    refreshOrganization
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
};