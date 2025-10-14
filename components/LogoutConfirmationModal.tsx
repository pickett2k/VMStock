import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { hybridSyncService } from '../services/HybridSyncService';

interface LogoutConfirmationModalProps {
  visible: boolean;
  onCancel: () => void;
  onConfirmLogout: (forceLogout?: boolean) => Promise<void>;
}

interface UnsyncedDataDetails {
  totalCount: number;
  operationsByType: Record<string, number>;
  operationsByCollection: Record<string, number>;
  hasUnsyncedData: boolean;
  oldestOperation?: { timestamp: number; age: string; type: string; collection: string };
}

/**
 * COMPONENT: LogoutConfirmationModal
 * PURPOSE: Safety net for logout - warns about unsynced data and offers options
 * 
 * FEATURES:
 * - Analyzes unsynced operations and shows detailed breakdown
 * - Offers three options: Force Sync & Logout, Cancel, or Logout Anyway
 * - Shows real-time sync progress during force sync
 * - Prevents accidental data loss with clear warnings
 * 
 * DATA SAFETY:
 * - Uses HybridSyncService.getUnsyncedDataDetails() for analysis
 * - Force sync option uses existing safelyLogoutUser() method
 * - Emergency logout only after explicit user confirmation
 */
export default function LogoutConfirmationModal({ 
  visible, 
  onCancel, 
  onConfirmLogout 
}: LogoutConfirmationModalProps) {
  const [unsyncedData, setUnsyncedData] = useState<UnsyncedDataDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (visible) {
      loadUnsyncedDataDetails();
    }
  }, [visible]);

  const loadUnsyncedDataDetails = async () => {
    setLoading(true);
    try {
      const details = await hybridSyncService.getUnsyncedDataDetails();
      const online = hybridSyncService.getOnlineStatus();
      setUnsyncedData(details);
      setIsOnline(online);
    } catch (error) {
      console.error('Failed to load unsynced data details:', error);
      // Show empty state on error
      setUnsyncedData({
        totalCount: 0,
        operationsByType: {},
        operationsByCollection: {},
        hasUnsyncedData: false
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForceSyncAndLogout = async () => {
    setSyncing(true);
    try {
      // Use the existing safe logout method that syncs first
      await onConfirmLogout(false);
    } catch (error: any) {
      Alert.alert(
        'Sync Failed',
        `Unable to sync data before logout: ${error?.message || error}\n\nWould you like to logout anyway? This will cause data loss.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Logout Anyway', 
            style: 'destructive',
            onPress: () => handleForceLogout()
          }
        ]
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleForceLogout = () => {
    Alert.alert(
      'Confirm Data Loss',
      `⚠️ WARNING: You will lose ${unsyncedData?.totalCount || 0} unsynced changes!\n\nThis action cannot be undone. Are you absolutely sure?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Yes, Logout Anyway', 
          style: 'destructive',
          onPress: async () => {
            try {
              await onConfirmLogout(true); // Force logout flag
            } catch (error: any) {
              Alert.alert('Logout Failed', error?.message || 'Unknown error occurred');
            }
          }
        }
      ]
    );
  };

  const formatOperationType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'create': 'Create',
      'update': 'Update', 
      'delete': 'Delete',
      'assignmentTransaction': 'Sales',
      'updateBalance': 'Balance Update',
      'stockDelta': 'Stock Change',
      'balanceDelta': 'Balance Change',
      'createAssignment': 'New Sale'
    };
    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1);
  };

  const formatCollection = (collection: string): string => {
    const collectionMap: Record<string, string> = {
      'products': 'Products',
      'players': 'Players/Customers',
      'assignments': 'Sales/Assignments',
      'staff-users': 'Staff Users',
      'organizations': 'Organization Settings'
    };
    return collectionMap[collection] || collection.charAt(0).toUpperCase() + collection.slice(1);
  };

  if (loading) {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Checking for unsynced data...</Text>
          </View>
        </View>
      </Modal>
    );
  }

  // If no unsynced data, show simple confirmation
  if (!unsyncedData?.hasUnsyncedData) {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modalContainer}>
            <View style={styles.header}>
              <Ionicons name="log-out-outline" size={24} color="#333" />
              <Text style={styles.title}>Confirm Logout</Text>
            </View>
            
            <Text style={styles.description}>
              All your data is synced. Are you sure you want to logout?
            </Text>

            <View style={styles.buttonContainer}>
              <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.confirmButton} 
                onPress={() => onConfirmLogout(false)}
              >
                <Text style={styles.confirmButtonText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Show detailed warning for unsynced data
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <View style={styles.header}>
            <Ionicons name="warning" size={24} color="#FF6B35" />
            <Text style={styles.title}>Unsynced Data Warning</Text>
          </View>
          
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                You have <Text style={styles.highlight}>{unsyncedData.totalCount} unsynced changes</Text> that 
                haven't been saved to the server yet.
              </Text>
              
              {!isOnline && (
                <View style={styles.offlineWarning}>
                  <Ionicons name="wifi-outline" size={16} color="#FF6B35" />
                  <Text style={styles.offlineText}>
                    You're currently offline - data cannot be synced now
                  </Text>
                </View>
              )}
            </View>

            {/* Breakdown by collection */}
            <View style={styles.breakdown}>
              <Text style={styles.breakdownTitle}>Changes by Category:</Text>
              {Object.entries(unsyncedData.operationsByCollection).map(([collection, count]) => (
                <View key={collection} style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>{formatCollection(collection)}</Text>
                  <Text style={styles.breakdownCount}>{count}</Text>
                </View>
              ))}
            </View>

            {/* Breakdown by operation type */}
            <View style={styles.breakdown}>
              <Text style={styles.breakdownTitle}>Changes by Type:</Text>
              {Object.entries(unsyncedData.operationsByType).map(([type, count]) => (
                <View key={type} style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>{formatOperationType(type)}</Text>
                  <Text style={styles.breakdownCount}>{count}</Text>
                </View>
              ))}
            </View>

            {/* Oldest operation info */}
            {unsyncedData.oldestOperation && (
              <View style={styles.ageInfo}>
                <Text style={styles.ageText}>
                  Oldest change: {unsyncedData.oldestOperation.age}
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            
            {isOnline && (
              <TouchableOpacity 
                style={[styles.syncButton, syncing && styles.disabledButton]} 
                onPress={handleForceSyncAndLogout}
                disabled={syncing}
              >
                {syncing ? (
                  <>
                    <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                    <Text style={styles.syncButtonText}>Syncing...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={16} color="white" style={{ marginRight: 8 }} />
                    <Text style={styles.syncButtonText}>Sync & Logout</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            
            <TouchableOpacity 
              style={styles.forceButton} 
              onPress={handleForceLogout}
            >
              <Ionicons name="warning" size={16} color="white" style={{ marginRight: 8 }} />
              <Text style={styles.forceButtonText}>Logout Anyway</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
    color: '#333',
  },
  loadingText: {
    marginTop: 12,
    textAlign: 'center',
    color: '#666',
  },
  description: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  content: {
    maxHeight: 300,
  },
  warningBox: {
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#FF6B35',
  },
  warningText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  highlight: {
    fontWeight: '600',
    color: '#FF6B35',
  },
  offlineWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 8,
    backgroundColor: '#FFE5DB',
    borderRadius: 6,
  },
  offlineText: {
    fontSize: 12,
    color: '#FF6B35',
    marginLeft: 6,
    fontWeight: '500',
  },
  breakdown: {
    marginBottom: 16,
  },
  breakdownTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  breakdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#F8F9FA',
    borderRadius: 4,
    marginBottom: 4,
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#666',
  },
  breakdownCount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    backgroundColor: '#E9ECEF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    textAlign: 'center',
  },
  ageInfo: {
    backgroundColor: '#F8F9FA',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  ageText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#F8F9FA',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '600',
  },
  syncButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#28A745',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  syncButtonText: {
    fontSize: 14,
    color: 'white',
    fontWeight: '600',
  },
  forceButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#DC3545',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  forceButtonText: {
    fontSize: 14,
    color: 'white',
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
});