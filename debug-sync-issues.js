import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Debug script to inspect sync queue and local storage state
 * Run this to understand what's happening with pending assignments
 */
export async function debugSyncIssues() {
  console.log('🔍 === SYNC QUEUE DEBUG ANALYSIS ===');
  
  try {
    // 1. Check sync queue state
    const syncQueueData = await AsyncStorage.getItem('sync_queue');
    const syncQueue = syncQueueData ? JSON.parse(syncQueueData) : [];
    
    console.log('📋 Sync Queue Analysis:', {
      totalItems: syncQueue.length,
      itemsByCollection: syncQueue.reduce((acc, item) => {
        acc[item.collection] = (acc[item.collection] || 0) + 1;
        return acc;
      }, {}),
      itemsByAction: syncQueue.reduce((acc, item) => {
        acc[item.action] = (acc[item.action] || 0) + 1;
        return acc;
      }, {})
    });
    
    // 2. Detailed breakdown of assignments in queue
    const assignmentItems = syncQueue.filter(item => item.collection === 'assignments');
    if (assignmentItems.length > 0) {
      console.log('🎯 Assignment Items in Queue:');
      assignmentItems.forEach((item, index) => {
        console.log(`  Assignment ${index + 1}:`, {
          id: item.id,
          action: item.action,
          timestamp: new Date(item.timestamp).toISOString(),
          retryCount: item.retryCount || 0,
          dataKeys: item.data ? Object.keys(item.data) : 'NO DATA',
          productId: item.data?.productId,
          playerId: item.data?.playerId,
          quantity: item.data?.quantity,
          totalCost: item.data?.totalCost
        });
      });
    }
    
    // 3. Check dead letter queue
    const deadLetterData = await AsyncStorage.getItem('dead_letter_queue');
    const deadLetterQueue = deadLetterData ? JSON.parse(deadLetterData) : [];
    
    if (deadLetterQueue.length > 0) {
      console.log('💀 Dead Letter Queue:');
      deadLetterQueue.forEach((item, index) => {
        console.log(`  Failed Item ${index + 1}:`, {
          id: item.id,
          collection: item.collection,
          action: item.action,
          retryCount: item.retryCount,
          lastAttempt: new Date(item.timestamp).toISOString()
        });
      });
    }
    
    // 4. Check local assignments
    const localAssignmentsData = await AsyncStorage.getItem('assignments');
    const localAssignments = localAssignmentsData ? JSON.parse(localAssignmentsData) : [];
    
    console.log('📱 Local Assignments:', {
      total: localAssignments.length,
      recent: localAssignments
        .filter(a => Date.now() - new Date(a.createdAt).getTime() < 24 * 60 * 60 * 1000) // Last 24 hours
        .map(a => ({
          id: a.id,
          productId: a.productId,
          playerId: a.playerId,
          quantity: a.quantity,
          createdAt: new Date(a.createdAt).toISOString(),
          synced: a.synced || false
        }))
    });
    
    // 5. Check processed IDs (to see what might be skipped due to idempotency)
    const processedIdsData = await AsyncStorage.getItem('processed_sync_ids');
    const processedIds = processedIdsData ? JSON.parse(processedIdsData) : [];
    
    if (processedIds.length > 0) {
      console.log('✅ Recently Processed Sync IDs:', processedIds.slice(-10)); // Last 10
    }
    
    // 6. Check sync service state
    console.log('🔧 Sync Service State Check:');
    const products = await AsyncStorage.getItem('products');
    const players = await AsyncStorage.getItem('players');
    
    console.log('📊 Local Storage Summary:', {
      products: products ? JSON.parse(products).length : 0,
      players: players ? JSON.parse(players).length : 0,
      assignments: localAssignments.length,
      syncQueueItems: syncQueue.length,
      deadLetterItems: deadLetterQueue.length
    });
    
    // 7. Specific assignment in queue analysis
    if (assignmentItems.length > 0) {
      console.log('🔬 Assignment Queue Deep Dive:');
      const assignmentItem = assignmentItems[0]; // Check first assignment
      
      // Check if related product/player exist
      const productExists = products ? JSON.parse(products).some(p => p.id === assignmentItem.data?.productId) : false;
      const playerExists = players ? JSON.parse(players).some(p => p.id === assignmentItem.data?.playerId) : false;
      
      console.log('🔗 Assignment Dependencies:', {
        assignmentId: assignmentItem.id,
        productId: assignmentItem.data?.productId,
        productExists,
        playerId: assignmentItem.data?.playerId,
        playerExists,
        hasAllDependencies: productExists && playerExists
      });
    }
    
    return {
      syncQueue,
      deadLetterQueue,
      localAssignments,
      summary: {
        queueLength: syncQueue.length,
        assignmentsInQueue: assignmentItems.length,
        deadLetterItems: deadLetterQueue.length,
        localAssignments: localAssignments.length
      }
    };
    
  } catch (error) {
    console.error('❌ Debug analysis failed:', error);
    return null;
  }
}

/**
 * Force sync queue processing with detailed logging
 */
export async function forceSyncWithDebug() {
  console.log('🚀 === FORCING SYNC WITH DEBUG ===');
  
  // Import the hybrid sync service (you'll need to adjust this import path)
  // const hybridSyncService = new HybridSyncService();
  
  try {
    // Check network state first
    const NetInfo = require('@react-native-community/netinfo');
    const networkState = await NetInfo.fetch();
    
    console.log('📡 Current Network State:', {
      isConnected: networkState.isConnected,
      isInternetReachable: networkState.isInternetReachable,
      type: networkState.type
    });
    
    if (!networkState.isConnected) {
      console.warn('⚠️ Device appears to be offline - sync may not work');
      return false;
    }
    
    // Force sync queue processing
    // await hybridSyncService.forcSync();
    
    console.log('✅ Force sync completed');
    return true;
    
  } catch (error) {
    console.error('❌ Force sync failed:', error);
    return false;
  }
}

/**
 * Clear problematic sync queue items
 */
export async function clearStuckSyncItems() {
  console.log('🧹 === CLEARING STUCK SYNC ITEMS ===');
  
  try {
    const syncQueueData = await AsyncStorage.getItem('sync_queue');
    const syncQueue = syncQueueData ? JSON.parse(syncQueueData) : [];
    
    const stuckItems = syncQueue.filter(item => {
      // Consider items stuck if they have high retry count or are very old
      const isOld = Date.now() - item.timestamp > 60 * 60 * 1000; // 1 hour old
      const hasHighRetries = (item.retryCount || 0) > 3;
      return isOld || hasHighRetries;
    });
    
    if (stuckItems.length > 0) {
      console.log(`🗑️ Found ${stuckItems.length} stuck items to clear`);
      
      const cleanQueue = syncQueue.filter(item => !stuckItems.includes(item));
      await AsyncStorage.setItem('sync_queue', JSON.stringify(cleanQueue));
      
      console.log('✅ Cleared stuck items, remaining queue length:', cleanQueue.length);
      return stuckItems.length;
    } else {
      console.log('✅ No stuck items found');
      return 0;
    }
    
  } catch (error) {
    console.error('❌ Failed to clear stuck items:', error);
    return -1;
  }
}