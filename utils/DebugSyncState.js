/**
 * Debug utility to inspect current sync state
 * Add this to your component and call it to see what's happening
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const debugSyncState = async () => {
  console.log('🔍 DEBUG SYNC STATE - Starting inspection...');
  
  try {
    // Check players in local storage
    const playersStr = await AsyncStorage.getItem('players');
    const players = playersStr ? JSON.parse(playersStr) : [];
    console.log('🔍 Local Storage Players:', {
      count: players.length,
      players: players.map(p => ({
        id: p.id,
        name: p.name || `${p.firstName} ${p.lastName}`,
        createdAt: p.createdAt,
        hasAllFields: !!(p.firstName && p.lastName && p.id)
      }))
    });
    
    // Check sync queue
    const queueStr = await AsyncStorage.getItem('sync_queue');
    const queue = queueStr ? JSON.parse(queueStr) : [];
    console.log('🔍 Sync Queue:', {
      count: queue.length,
      items: queue.map(item => ({
        id: item.id,
        collection: item.collection,
        action: item.action,
        timestamp: new Date(item.timestamp).toLocaleString(),
        retryCount: item.retryCount,
        entityId: item.data?.entityId || item.data?.id
      }))
    });
    
    // Check vector clock
    const clockStr = await AsyncStorage.getItem('vector_clock');
    const clock = clockStr ? JSON.parse(clockStr) : {};
    console.log('🔍 Vector Clock:', clock);
    
    return {
      players,
      queue,
      clock
    };
    
  } catch (error) {
    console.error('❌ Error debugging sync state:', error);
    return null;
  }
};

// Add to global for easy console access
if (typeof window !== 'undefined') {
  window.debugSyncState = debugSyncState;
}