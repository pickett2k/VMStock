import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hybridSyncService } from '../services/HybridSyncService';
import { useOrganization } from '../contexts/OrganizationContext';

/**
 * Temporary Debug Panel Component
 * Add this to your app to diagnose sync issues
 */
export const SyncDebugPanel = () => {
  const [debugOutput, setDebugOutput] = React.useState('');
  const { refreshOrganization, organization } = useOrganization();

  const addToOutput = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugOutput(prev => `[${timestamp}] ${message}\n${prev}`);
  };

  const runSyncDiagnostics = async () => {
    addToOutput('🔍 Starting sync diagnostics...');
    
    try {
      // 1. Check sync queue state
      const syncQueueData = await AsyncStorage.getItem('sync_queue');
      const syncQueue = syncQueueData ? JSON.parse(syncQueueData) : [];
      
      addToOutput(`📋 Sync Queue: ${syncQueue.length} items total`);
      
      // Count by collection
      const byCollection = syncQueue.reduce((acc: any, item: any) => {
        acc[item.collection] = (acc[item.collection] || 0) + 1;
        return acc;
      }, {});
      
      addToOutput(`📊 By Collection: ${JSON.stringify(byCollection)}`);
      
      // 2. Check pending bundles (new bundle system)
      const pendingBundlesData = await AsyncStorage.getItem('pending_bundles');
      const pendingBundles = pendingBundlesData ? JSON.parse(pendingBundlesData) : [];
      
      addToOutput(`📦 Pending Bundles: ${pendingBundles.length}`);
      if (pendingBundles.length > 0) {
        pendingBundles.forEach((bundle: any, index: number) => {
          addToOutput(`  Bundle ${index + 1}: ${bundle.bundleId} (${bundle.type}) - ${bundle.steps.length} steps`);
          bundle.steps.forEach((step: any, stepIndex: number) => {
            addToOutput(`    Step ${stepIndex + 1}: ${step.kind} - ${step.opId}`);
          });
        });
      } else {
        addToOutput('✅ No pending bundles (new system)');
      }

      // 3. Detailed assignment analysis (legacy sync queue)
      const assignmentItems = syncQueue.filter((item: any) => item.collection === 'assignments');
      if (assignmentItems.length > 0) {
        addToOutput(`🎯 Assignment Items (legacy): ${assignmentItems.length}`);
        assignmentItems.forEach((item: any, index: number) => {
          addToOutput(`  Assignment ${index + 1}: ${item.action} - ID:${item.id} - Retries:${item.retryCount || 0}`);
          if (item.data) {
            addToOutput(`    Product:${item.data.productId} Player:${item.data.playerId} Qty:${item.data.quantity}`);
          }
        });
      } else {
        addToOutput('✅ No assignments in sync queue (legacy)');
      }
      
      // 3. Check dead letter queue
      const deadLetterData = await AsyncStorage.getItem('dead_letter_queue');
      const deadLetterQueue = deadLetterData ? JSON.parse(deadLetterData) : [];
      
      if (deadLetterQueue.length > 0) {
        addToOutput(`💀 Dead Letter Queue: ${deadLetterQueue.length} failed items`);
      } else {
        addToOutput('✅ No failed items in dead letter queue');
      }
      
      // 4. Check local assignments
      const localAssignmentsData = await AsyncStorage.getItem('assignments');
      const localAssignments = localAssignmentsData ? JSON.parse(localAssignmentsData) : [];
      
      addToOutput(`📱 Local Assignments: ${localAssignments.length} total`);
      
      // Recent assignments (last 24 hours)
      const recent = localAssignments.filter((a: any) => 
        Date.now() - new Date(a.createdAt).getTime() < 24 * 60 * 60 * 1000
      );
      addToOutput(`📅 Recent (24h): ${recent.length} assignments`);
      
      // 5. Check sync service state
      const syncStatus = hybridSyncService.getSyncStatus();
      addToOutput(`🔧 Sync Status: ${JSON.stringify(syncStatus)}`);
      
      addToOutput('✅ Diagnostics completed!');
      
    } catch (error) {
      addToOutput(`❌ Diagnostics failed: ${error}`);
    }
  };

  const forceSyncNow = async () => {
    addToOutput('🚀 Forcing sync...');
    try {
      await hybridSyncService.forceSyncNow();
      addToOutput('✅ Force sync completed');
    } catch (error) {
      addToOutput(`❌ Force sync failed: ${error}`);
      console.error('Force sync error details:', error);
    }
  };

  const forceOrgRefresh = async () => {
    addToOutput('🏢 Force refreshing organization settings from server...');
    try {
      if (!organization) {
        addToOutput('❌ No organization loaded');
        return;
      }
      
      addToOutput(`🔍 Current org: ${organization.name} (${organization.id})`);
      addToOutput(`🔍 Current logo: ${organization.logoUrl || 'none'}`);
      addToOutput(`🔍 Current shop PIN: ${organization.shopPin || 'none'}`);
      addToOutput(`🔍 Current currency: ${organization.currency || 'none'}`);
      
      // Show cache contents before refresh
      const orgCache = await AsyncStorage.getItem('organizations');
      const orgFromCache = orgCache ? JSON.parse(orgCache) : null;
      addToOutput(`📱 Cache has ${orgFromCache?.length || 0} organizations`);
      
      const orgContext = await AsyncStorage.getItem('@organization_data');
      const contextOrg = orgContext ? JSON.parse(orgContext) : null;
      addToOutput(`🏛️ Context org: ${contextOrg?.name || 'none'}`);
      
      // Force refresh from server
      await refreshOrganization(true);
      
      // Show cache contents after refresh
      const newOrgCache = await AsyncStorage.getItem('organizations');
      const newOrgFromCache = newOrgCache ? JSON.parse(newOrgCache) : null;
      addToOutput(`📱 After refresh - Cache has ${newOrgFromCache?.length || 0} organizations`);
      
      const newOrgContext = await AsyncStorage.getItem('@organization_data');
      const newContextOrg = newOrgContext ? JSON.parse(newOrgContext) : null;
      addToOutput(`🏛️ After refresh - Context org logo: ${newContextOrg?.logoUrl || 'none'}`);
      addToOutput(`🏛️ After refresh - Context org PIN: ${newContextOrg?.shopPin || 'none'}`);
      
      addToOutput('✅ Organization force refresh completed - check if settings updated');
    } catch (error) {
      addToOutput(`❌ Organization refresh failed: ${error}`);
      console.error('Org refresh error details:', error);
    }
  };

  const inspectFirebaseOrg = async () => {
    addToOutput('🔍 Inspecting Firebase organization data directly...');
    try {
      if (!organization) {
        addToOutput('❌ No organization loaded');
        return;
      }

      // Import Firebase modules
      const { doc, getDoc } = await import('firebase/firestore');
      const { FirebaseFirestore } = await import('../config/firebase');
      
      addToOutput(`🔍 Querying Firebase for org: ${organization.id}`);
      const orgDocRef = doc(FirebaseFirestore, 'organizations', organization.id);
      const orgDoc = await getDoc(orgDocRef);
      
      if (orgDoc.exists()) {
        const firebaseData = orgDoc.data();
        addToOutput('✅ Firebase document exists!');
        addToOutput(`🔍 Firebase org name: ${firebaseData.name || 'none'}`);
        addToOutput(`🔍 Firebase logo: ${firebaseData.logoUrl || 'none'}`);
        addToOutput(`🔍 Firebase shop PIN: ${firebaseData.shopPin || 'none'}`);
        addToOutput(`🔍 Firebase currency: ${firebaseData.currency || 'none'}`);
        addToOutput(`🔍 Firebase settings: ${JSON.stringify(firebaseData.settings || {})}`);
        addToOutput(`🔍 Full Firebase data keys: ${Object.keys(firebaseData).join(', ')}`);
      } else {
        addToOutput('❌ Firebase document does not exist!');
        addToOutput(`❌ Tried path: organizations/${organization.id}`);
      }
    } catch (error) {
      addToOutput(`❌ Firebase inspection failed: ${error}`);
      console.error('Firebase inspection error details:', error);
    }
  };

  const checkNetworkState = async () => {
    addToOutput('📡 Checking network state...');
    try {
      const NetInfo = require('@react-native-community/netinfo');
      const state = await NetInfo.fetch();
      
      addToOutput(`📶 Network: Connected=${state.isConnected}, Reachable=${state.isInternetReachable}, Type=${state.type}`);
      
      // Also check HybridSyncService internal state
      const syncStatus = hybridSyncService.getSyncStatus();
      addToOutput(`🔧 Internal: Online=${syncStatus.isOnline}, Syncing=${syncStatus.isSyncing}`);
      
    } catch (error) {
      addToOutput(`❌ Network check failed: ${error}`);
    }
  };

  const clearStuckItems = async () => {
    addToOutput('🧹 Clearing stuck sync items...');
    try {
      const syncQueueData = await AsyncStorage.getItem('sync_queue');
      const syncQueue = syncQueueData ? JSON.parse(syncQueueData) : [];
      
      const stuckItems = syncQueue.filter((item: any) => {
        const isOld = Date.now() - item.timestamp > 60 * 60 * 1000; // 1 hour
        const hasHighRetries = (item.retryCount || 0) > 3;
        return isOld || hasHighRetries;
      });
      
      if (stuckItems.length > 0) {
        const cleanQueue = syncQueue.filter((item: any) => !stuckItems.includes(item));
        await AsyncStorage.setItem('sync_queue', JSON.stringify(cleanQueue));
        addToOutput(`🗑️ Cleared ${stuckItems.length} stuck items`);
      } else {
        addToOutput('✅ No stuck items found');
      }
      
    } catch (error) {
      addToOutput(`❌ Clear failed: ${error}`);
    }
  };

  const resurrectDeadLetterItems = async () => {
    addToOutput('♻️ Resurrecting dead letter queue items...');
    try {
      const deadLetterData = await AsyncStorage.getItem('dead_letter_queue');
      const deadLetterQueue = deadLetterData ? JSON.parse(deadLetterData) : [];
      
      if (deadLetterQueue.length === 0) {
        addToOutput('✅ No items in dead letter queue to resurrect');
        return;
      }

      // Move items back to main queue
      const syncQueueData = await AsyncStorage.getItem('sync_queue');
      const syncQueue = syncQueueData ? JSON.parse(syncQueueData) : [];
      
      // Reset retry counts and timestamps
      const resurrectedItems = deadLetterQueue.map((item: any) => ({
        ...item,
        retryCount: 0,
        timestamp: Date.now()
      }));
      
      // Add to main queue
      syncQueue.push(...resurrectedItems);
      
      // Clear dead letter queue
      await AsyncStorage.setItem('sync_queue', JSON.stringify(syncQueue));
      await AsyncStorage.setItem('dead_letter_queue', JSON.stringify([]));
      
      addToOutput(`♻️ Resurrected ${resurrectedItems.length} items from dead letter queue`);
      addToOutput(`📊 Main queue now has ${syncQueue.length} items`);
      
    } catch (error) {
      addToOutput(`❌ Resurrection failed: ${error}`);
    }
  };

  const simulateNetworkIssue = async () => {
    addToOutput('🌐 Simulating network issue scenario...');
    addToOutput('💡 This demonstrates the enhanced retry logic:');
    addToOutput('  • Network issues: 15 retries with gentle backoff');  
    addToOutput('  • Real failures: 3 retries with exponential backoff');
    addToOutput('  • Offline failures: No retry count increment');
    addToOutput('🔍 Watch the console logs during sync for error classification!');
  };

  const clearDebugOutput = () => {
    setDebugOutput('');
  };

  const logToConsole = async () => {
    const timestamp = new Date().toISOString();
    
    // Enhanced console logging with more visibility for Expo CLI
    console.log('\n' + '='.repeat(50));
    console.log('🔍 SYNC DEBUG CONSOLE OUTPUT');
    console.log('Timestamp:', timestamp);
    console.log('='.repeat(50));
    
    try {
      // Log sync queue
      const syncQueueData = await AsyncStorage.getItem('sync_queue');
      const syncQueue = syncQueueData ? JSON.parse(syncQueueData) : [];
      console.log('\n📋 SYNC QUEUE:');
      console.log('Length:', syncQueue.length);
      if (syncQueue.length > 0) {
        syncQueue.forEach((item: any, index: number) => {
          console.log(`  ${index + 1}. ${item.collection}/${item.action} - ID: ${item.id}`);
          console.log(`     Retries: ${item.retryCount || 0}, Time: ${new Date(item.timestamp).toLocaleTimeString()}`);
          if (item.data) {
            console.log(`     Data: ProductId=${item.data.productId}, PlayerId=${item.data.playerId}`);
          }
        });
      } else {
        console.log('  (empty)');
      }
      
      // Log dead letter queue  
      const deadLetterData = await AsyncStorage.getItem('dead_letter_queue');
      const deadLetterQueue = deadLetterData ? JSON.parse(deadLetterData) : [];
      console.log('\n💀 DEAD LETTER QUEUE:');
      console.log('Length:', deadLetterQueue.length);
      if (deadLetterQueue.length > 0) {
        deadLetterQueue.forEach((item: any, index: number) => {
          console.log(`  ${index + 1}. ${item.collection}/${item.action} - ID: ${item.id}`);
        });
      } else {
        console.log('  (empty)');
      }
      
      // Log sync service status
      const syncStatus = hybridSyncService.getSyncStatus();
      console.log('\n⚙️ SYNC STATUS:');
      console.log('  Online:', syncStatus.isOnline);
      console.log('  Syncing:', syncStatus.isSyncing);
      
      console.log('='.repeat(50) + '\n');
      
      // Also try console.warn and console.error for better visibility
      console.warn('🔍 SYNC DEBUG - Check above for detailed output');
      console.error('🔍 SYNC DEBUG - This should show in Expo CLI terminal');
      
      addToOutput('📋 Full diagnostics logged to console - check Expo CLI terminal');
    } catch (error) {
      console.error('❌ Console logging failed:', error);
      addToOutput(`❌ Console logging failed: ${error}`);
    }
  };

  const debugSyncFailure = async () => {
    addToOutput('🐛 Deep diving into sync failure...');
    
    try {
      const syncQueueData = await AsyncStorage.getItem('sync_queue');
      const syncQueue = syncQueueData ? JSON.parse(syncQueueData) : [];
      
      if (syncQueue.length === 0) {
        addToOutput('No items in sync queue to debug');
        return;
      }
      
      const assignmentItems = syncQueue.filter((item: any) => item.collection === 'assignments');
      
      for (const item of assignmentItems) {
        addToOutput(`🔍 Debugging item: ${item.id}`);
        addToOutput(`  Action: ${item.action}, Retries: ${item.retryCount || 0}`);
        addToOutput(`  Timestamp: ${new Date(item.timestamp).toLocaleString()}`);
        addToOutput(`  Has Data: ${!!item.data}`);
        
        if (item.data) {
          addToOutput(`  ProductId: ${item.data.productId}, PlayerId: ${item.data.playerId}`);
        }
        
        // Try to process this specific item
        try {
          addToOutput(`  🚀 Attempting manual sync for ${item.id}...`);
          await hybridSyncService.debugProcessSingleItem(item);
          addToOutput(`  ✅ Manual sync succeeded for ${item.id}`);
        } catch (error) {
          addToOutput(`  ❌ Manual sync failed: ${error}`);
          console.error('Manual sync error details:', error);
        }
      }
      
    } catch (error) {
      addToOutput(`❌ Debug failed: ${error}`);
    }
  };

  const clearAllStuckData = async () => {
    addToOutput('🧹 Clearing all stuck data...');
    console.log('🧹 Clearing all stuck data...');
    
    try {
      await hybridSyncService.clearAllStuckData();
      addToOutput('✅ All stuck data cleared successfully');
      console.log('✅ All stuck data cleared successfully');
    } catch (error) {
      addToOutput(`❌ Failed to clear stuck data: ${error}`);
      console.error('❌ Failed to clear stuck data:', error);
    }
  };

  const resetSalesData = async () => {
    addToOutput('🔄 Resetting all sales data...');
    console.log('🔄 Resetting all sales data...');
    
    try {
      await hybridSyncService.resetAllSalesData();
      addToOutput('✅ All sales data reset successfully');
      console.log('✅ All sales data reset successfully');
      
      // Add debug check after reset
      setTimeout(async () => {
        try {
          const players = await hybridSyncService.getPlayers();
          console.log('🔍 POST-RESET DEBUG - Player balances:');
          players.forEach(player => {
            console.log(`  ${player.name}: balance=${player.balance}, totalSpent=${player.totalSpent}`);
          });
        } catch (debugError) {
          console.error('Failed to debug post-reset state:', debugError);
        }
      }, 2000);
      
    } catch (error) {
      addToOutput(`❌ Failed to reset sales data: ${error}`);
      console.error('❌ Failed to reset sales data:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔍 Sync Debug Panel</Text>
      
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={runSyncDiagnostics}>
          <Text style={styles.buttonText}>Run Diagnostics</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={checkNetworkState}>
          <Text style={styles.buttonText}>Check Network</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={forceSyncNow}>
          <Text style={styles.buttonText}>Force Sync</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={forceOrgRefresh}>
          <Text style={styles.buttonText}>🏢 Org Refresh</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={inspectFirebaseOrg}>
          <Text style={styles.buttonText}>🔍 Check Firebase</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={clearStuckItems}>
          <Text style={styles.buttonText}>Clear Stuck</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={resurrectDeadLetterItems}>
          <Text style={styles.buttonText}>♻️ Resurrect Dead Items</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={simulateNetworkIssue}>
          <Text style={styles.buttonText}>🌐 Network Info</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={logToConsole}>
          <Text style={styles.buttonText}>📋 Log to Console</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={debugSyncFailure}>
          <Text style={styles.buttonText}>🐛 Debug Sync</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={clearAllStuckData}>
          <Text style={styles.buttonText}>🧹 Clear All Stuck</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={resetSalesData}>
          <Text style={styles.buttonText}>🔄 Reset Sales</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.clearButton} onPress={clearDebugOutput}>
        <Text style={styles.buttonText}>Clear Output</Text>
      </TouchableOpacity>
      
      <ScrollView style={styles.outputContainer}>
        <Text style={styles.output}>{debugOutput || 'Tap "Run Diagnostics" to start...'}</Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    flex: 0.48,
  },
  clearButton: {
    backgroundColor: '#FF3B30',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  outputContainer: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 8,
    padding: 12,
  },
  output: {
    color: '#00ff00',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
});

export default SyncDebugPanel;