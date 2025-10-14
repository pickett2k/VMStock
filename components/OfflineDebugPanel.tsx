import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { HybridSyncService } from '../services/HybridSyncService';

const hybridSyncService = new HybridSyncService();

export default function OfflineDebugPanel() {
  const [isOnline, setIsOnline] = useState(true);
  const [syncQueueLength, setSyncQueueLength] = useState(0);

  const updateNetworkStatus = async () => {
    const networkState = await hybridSyncService.refreshNetworkState();
    const queueLength = hybridSyncService.getSyncQueueLength();
    setIsOnline(networkState);
    setSyncQueueLength(queueLength);
  };

  const forceOfflineMode = () => {
    hybridSyncService.forceOfflineMode();
    updateNetworkStatus();
    Alert.alert('Debug', 'Forced offline mode');
  };

  const forceOnlineMode = () => {
    hybridSyncService.forceOnlineMode();
    updateNetworkStatus();
    Alert.alert('Debug', 'Forced online mode');
  };

  const checkLocalData = async () => {
    try {
      const products = await hybridSyncService.getProducts();
      const players = await hybridSyncService.getPlayers();
      const assignments = await hybridSyncService.getAssignments();
      
      Alert.alert('Local Data Check', 
        `Products: ${products.length}\nPlayers: ${players.length}\nAssignments: ${assignments.length}\nSync Queue: ${syncQueueLength}`);
      
      console.log('📊 LOCAL DATA DEBUG:', {
        products: products.length,
        players: players.length,
        assignments: assignments.length,
        syncQueue: syncQueueLength,
        isOnline: isOnline
      });
    } catch (error) {
      console.error('❌ Error checking local data:', error);
      Alert.alert('Error', 'Failed to check local data');
    }
  };

  const testOfflineAssignment = async () => {
    try {
      // First, make sure we have test data
      const products = await hybridSyncService.getProducts();
      const players = await hybridSyncService.getPlayers();
      
      if (products.length === 0 || players.length === 0) {
        Alert.alert('Error', 'No products or players available for testing');
        return;
      }
      
      const testProduct = products[0];
      const testPlayer = players[0];
      
      if (testProduct.stock < 1) {
        Alert.alert('Error', 'No stock available for testing');
        return;
      }
      
      console.log('🧪 Testing offline assignment with:', {
        product: testProduct.name,
        player: testPlayer.name,
        stock: testProduct.stock,
        isOnline: isOnline
      });
      
      const transactionData = {
        productId: testProduct.id,
        productName: testProduct.name,
        userName: testPlayer.name,
        playerId: testPlayer.id,
        quantity: 1,
        unitPrice: testProduct.price,
        total: testProduct.price,
        organizationId: testProduct.organizationId || 'test-org',
        notes: 'Offline test transaction'
      };
      
      const assignmentId = await hybridSyncService.createAssignmentTransaction(transactionData);
      
      Alert.alert('Success', `Test assignment created: ${assignmentId}`);
      console.log('✅ Test assignment created successfully:', assignmentId);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Test assignment failed:', error);
      Alert.alert('Test Failed', errorMessage);
    }
  };

  React.useEffect(() => {
    updateNetworkStatus();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Offline Debug Panel</Text>
      
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>Network: {isOnline ? '🟢 Online' : '🔴 Offline'}</Text>
        <Text style={styles.statusText}>Queue: {syncQueueLength}</Text>
      </View>
      
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={forceOfflineMode}>
          <Text style={styles.buttonText}>Force Offline</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={forceOnlineMode}>
          <Text style={styles.buttonText}>Force Online</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={updateNetworkStatus}>
          <Text style={styles.buttonText}>Refresh Status</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={checkLocalData}>
          <Text style={styles.buttonText}>Check Local Data</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={testOfflineAssignment}>
          <Text style={styles.buttonText}>Test Offline Assignment</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f0f0f0',
    padding: 10,
    marginVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 5,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 80,
  },
  buttonText: {
    color: 'white',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
});