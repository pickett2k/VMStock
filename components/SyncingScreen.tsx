import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { hybridSyncService } from '../services/HybridSyncService';
import { useTheme } from '../app/ThemeContext';
import { MaterialIcons } from '@expo/vector-icons';
import { Platform } from 'react-native';

// Conditional Stripe import to prevent web bundling issues
let stripeTerminalService: any = null;
if (Platform.OS !== 'web') {
  try {
    const stripe = require('../services/StripeTerminalService');
    stripeTerminalService = stripe.stripeTerminalService;
  } catch (error) {
    console.warn('Stripe terminal service not available:', error);
  }
}

const STRIPE_ENABLED = process.env.STRIPE_ENABLED === 'true';

interface SyncingScreenProps {
  onSyncComplete: () => void;
  onSyncFailed: () => void;
}

export default function SyncingScreen({ onSyncComplete, onSyncFailed }: SyncingScreenProps) {
  const [syncStatus, setSyncStatus] = useState<string>('Connecting to Tuck Shop...');
  const [progress, setProgress] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const { user, checkUserRole } = useAuth();
  const { isDarkMode } = useTheme();

  const maxRetries = 3;

  const performSync = async () => {
    try {
      setHasError(false);
      setSyncStatus('Connecting to Tuck Shop...');
      setProgress(10);
      console.log('🔄 SyncingScreen - Starting sync process');

      // ENABLE FORCE SERVER MODE for login sync - bypass conflict resolution
      console.log('💪 SyncingScreen - Enabling force server mode for login sync');
      hybridSyncService.enableForceServerMode();

      // Small delay to show the initial message
      await new Promise(resolve => setTimeout(resolve, 800));

      setSyncStatus('Verifying your permissions...');
      setProgress(25);

      // Check user role first
      console.log('🔄 SyncingScreen - Checking user role for:', user?.uid);
      await checkUserRole();
      
      setSyncStatus('Processing data migration...');
      setProgress(40);
      
      // Wait a bit for migration to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSyncStatus('Preloading critical data...');
      setProgress(50);
      
      // Use HybridSyncService to preload all critical data for offline use
      console.log('🚀 SyncingScreen - Preloading critical data via HybridSyncService');
      
      // Process any pending bundles first (offline changes that need syncing)
      setSyncStatus('Syncing offline changes...');
      setProgress(55);
      console.log(`🔄 SyncingScreen - Processing pending bundles and syncing with server on ${Platform.OS}`);
      
      // This handles bundle sync (uploads local changes)
      await hybridSyncService.forceSyncNow();
      
      // Now hydrate from server to get changes made by others (applies via applyOp with vector clocks)
      setSyncStatus('Applying server changes...');
      setProgress(60);
      console.log(`🔄 SyncingScreen - Hydrating latest server changes via applyOp on ${Platform.OS}`);
      await hybridSyncService.hydrateFromServerForStartup();
      
      // Now preload data with the merged results (includes both local and server changes)
      setSyncStatus('Loading players...');
      setProgress(65);
      console.log(`🔄 SyncingScreen - Loading merged player data on ${Platform.OS}`);
      const players = await hybridSyncService.getPlayers();
      console.log(`✅ SyncingScreen - Loaded ${players.length} players on ${Platform.OS}:`, players.map(p => p.name || p.id).join(', '));
      
      // Diagnostic check for missing players
      if (players.length === 0) {
        console.warn(`⚠️ SyncingScreen - No players loaded on ${Platform.OS}! This may indicate a sync issue.`);
        console.warn('📱 Connection status:', hybridSyncService.getConnectionStatus());
        console.warn('🔄 Sync status:', hybridSyncService.getSyncStatus());
      }
      
      // Preload products
      setSyncStatus('Loading products...');
      setProgress(70);
      console.log(`🔄 SyncingScreen - Loading products on ${Platform.OS}`);
      const products = await hybridSyncService.getProducts();
      console.log(`✅ SyncingScreen - Loaded ${products.length} products on ${Platform.OS}:`, products.map((p: any) => p.name || p.id).join(', '));
      
      // Preload assignments  
      setSyncStatus('Loading assignments...');
      setProgress(75);
      console.log(`🔄 SyncingScreen - Loading assignments on ${Platform.OS}`);
      const assignments = await hybridSyncService.getAssignments();
      console.log(`✅ SyncingScreen - Loaded ${assignments.length} assignments on ${Platform.OS}`);
      
      // Initialize Stripe Terminal if enabled
      if (STRIPE_ENABLED) {
        setSyncStatus('Setting up payment systems...');
        setProgress(85);
        
        try {
          console.log('🔄 SyncingScreen - Initializing Stripe Terminal...');
          const stripeInitialized = await stripeTerminalService.initialize();
          
          if (stripeInitialized) {
            console.log('✅ SyncingScreen - Stripe Terminal initialized successfully');
          } else {
            console.warn('⚠️ SyncingScreen - Stripe Terminal initialization failed, continuing without payment features');
          }
        } catch (error) {
          console.warn('⚠️ SyncingScreen - Stripe Terminal initialization error:', error);
          // Don't fail the sync, just log and continue
        }
        
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      setSyncStatus('Finalizing setup...');
      setProgress(95);

      // Small delay to show completion
      await new Promise(resolve => setTimeout(resolve, 500));

      setProgress(100);
      setSyncStatus('Ready!');
      
      // Small delay before transitioning
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('✅ SyncingScreen - Sync completed successfully');
      
      // DISABLE FORCE SERVER MODE after sync completes
      hybridSyncService.disableForceServerMode();
      console.log('🔒 SyncingScreen - Disabled force server mode after successful sync');
      
      onSyncComplete();

    } catch (error) {
      console.error('❌ SyncingScreen - Sync failed:', error);
      
      // DISABLE FORCE SERVER MODE if sync fails
      hybridSyncService.disableForceServerMode();
      console.log('🔒 SyncingScreen - Disabled force server mode after sync failure');
      
      setHasError(true);
      
      if (retryCount < maxRetries) {
        setSyncStatus(`Sync failed. Retrying... (${retryCount + 1}/${maxRetries})`);
        setRetryCount(prev => prev + 1);
        
        // Retry after a delay
        setTimeout(() => {
          performSync();
        }, 2000);
      } else {
        setSyncStatus('Sync failed. Check your connection.');
        
        Alert.alert(
          'Connection Required',
          'Unable to sync with the Tuck Shop database. Please check your internet connection or mobile signal and try again.',
          [
            {
              text: 'Retry',
              onPress: () => {
                setRetryCount(0);
                setProgress(0);
                performSync();
              }
            },
            {
              text: 'Sign Out',
              style: 'destructive',
              onPress: onSyncFailed
            }
          ]
        );
      }
    }
  };

  useEffect(() => {
    if (user) {
      console.log('🔄 SyncingScreen - Starting sync for user:', user.uid);
      performSync();
    }
  }, [user]);

  const handleRetry = () => {
    setRetryCount(0);
    setProgress(0);
    setHasError(false);
    performSync();
  };

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <Image
        source={require('../assets/images/VM.png')}
        style={styles.logo}
      />
      
      <Text style={[styles.title, isDarkMode && styles.darkText]}>
        VM Tuck Shop
      </Text>
      
      <View style={styles.syncContainer}>
        {!hasError ? (
          <ActivityIndicator size="large" color="#007bff" style={styles.spinner} />
        ) : (
          <MaterialIcons name="error-outline" size={48} color="#ff6b6b" style={styles.spinner} />
        )}
        
        <Text style={[styles.statusText, isDarkMode && styles.darkText, hasError && styles.errorText]}>
          {syncStatus}
        </Text>
        
        {!hasError && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBackground}>
              <View 
                style={[styles.progressBar, { width: `${progress}%` }]} 
              />
            </View>
            <Text style={[styles.progressText, isDarkMode && styles.darkText]}>
              {progress}%
            </Text>
          </View>
        )}

        {hasError && retryCount >= maxRetries && (
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <MaterialIcons name="refresh" size={20} color="#fff" />
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.subtitle, isDarkMode && styles.darkSubtitle]}>
        {hasError 
          ? 'Please check your internet connection'
          : 'Setting up your personalized experience...'
        }
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 40,
  },
  darkText: {
    color: '#fff',
  },
  syncContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  spinner: {
    marginBottom: 20,
  },
  statusText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  errorText: {
    color: '#ff6b6b',
  },
  progressContainer: {
    alignItems: 'center',
    width: '100%',
  },
  progressBarBackground: {
    width: '80%',
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#007bff',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: '#999',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007bff',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  darkSubtitle: {
    color: '#666',
  },
});