/**
 * Utility script to reset player data for clean testing
 * Run this in the browser console or as a standalone script
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const resetPlayerData = async () => {
  try {
    console.log('🧹 Starting player data reset...');
    
    // Clear local player cache
    await AsyncStorage.removeItem('players');
    console.log('✅ Cleared local players cache');
    
    // Clear sync queue of any player operations
    const queueStr = await AsyncStorage.getItem('sync_queue');
    if (queueStr) {
      const queue = JSON.parse(queueStr);
      const filteredQueue = queue.filter(item => item.collection !== 'players');
      await AsyncStorage.setItem('sync_queue', JSON.stringify(filteredQueue));
      console.log('✅ Cleared player operations from sync queue');
    }
    
    // Clear vector clock to reset sync state
    await AsyncStorage.removeItem('vector_clock');
    console.log('✅ Reset vector clock');
    
    console.log('🎉 Player data reset complete!');
    console.log('📋 Next steps:');
    console.log('1. Go to Firebase Console');
    console.log('2. Delete all documents in the "players" collection');
    console.log('3. Refresh the app');
    console.log('4. Test creating new players');
    
    return true;
  } catch (error) {
    console.error('❌ Error during reset:', error);
    return false;
  }
};

// For direct execution in console
if (typeof window !== 'undefined') {
  window.resetPlayerData = resetPlayerData;
}