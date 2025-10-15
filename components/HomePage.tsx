import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Dimensions,
  ScrollView,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Modal,
  Pressable,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { NavigationProp, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../app/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { FirebaseAuth } from '../config/firebase';
import { useOrganization } from '../contexts/OrganizationContext';
import { firebaseService } from '../services/FirebaseService';
import { hybridSyncService } from '../services/HybridSyncService';
import BiometricSettings from './BiometricSettings';
import QRCode from 'react-native-qrcode-svg';
import LogoutConfirmationModal from './LogoutConfirmationModal';
import { StockDebugPanel } from './StockDebugPanel';

type HomePageProps = {
  navigation: NavigationProp<any>;
};

export default function HomePage({ navigation }: HomePageProps) {
  const { width } = Dimensions.get('window');
  const isLargeScreen = width > 600;
  const { isDarkMode } = useTheme();
  const { logout, user, isAdmin, isOwner, assignedPlayer, checkUserRole } = useAuth();
  const { organization } = useOrganization();
  const [showMenu, setShowMenu] = useState(false);
  const [isResetModalVisible, setResetModalVisible] = useState(false);
  const menuToggleTimeoutRef = useRef<number | null>(null);

  const [showQR, setShowQR] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState('');
  const resetCode = '07525040441';
  const [hasCharges, setHasCharges] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showStockDebugPanel, setShowStockDebugPanel] = useState(false);


  console.log('🏠 HomePage - isAdmin value:', isAdmin);
  console.log('🏠 HomePage - user UID:', user?.uid);
  console.log('🏠 HomePage - assignedPlayer:', assignedPlayer);
  console.log('🏠 HomePage - organization:', organization?.name);

  // Debounced menu toggle to prevent rapid open/close flickering
  const toggleMenu = useCallback(() => {
    if (menuToggleTimeoutRef.current) {
      clearTimeout(menuToggleTimeoutRef.current);
    }
    
    menuToggleTimeoutRef.current = setTimeout(() => {
      setShowMenu(prev => !prev);
    }, 50); // Small delay to prevent rapid toggling
  }, []);

  // QR Code helper functions
  const generateQRData = () => {
    if (!organization) return '';
    return JSON.stringify({
      type: 'vmstock_organization',
      shopPin: organization.shopPin,
      name: organization.displayName,
      currency: organization.currency,
    });
  };

  const handleShareQR = async () => {
    // For now, just share the PIN
    const shareText = `Join "${organization?.displayName}" in VMStock using PIN: ${organization?.shopPin}`;
    try {
      await Share.share({
        message: shareText,
        title: 'VMStock Organization',
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  // Check if there are any unpaid charges for conditional UI
  // Check charges existence using provisional overlay system (offline-first)
  const checkChargesExistence = useCallback(async () => {
    try {
      // Use overlay system (same as PlayerBills/PlayerCharges components)
      const charges = await hybridSyncService.getChargesWithOverlay();
      const unpaidCharges = charges.filter((c: any) => {
        const playerName = c.playerName;
        const isValid = playerName && playerName !== 'Unknown Player' && playerName.trim() !== '';
        const isUnpaid = c.status !== 'paid';
        const hasValidAmount = c.amount !== undefined && c.amount !== null && c.amount > 0;
        
        return isValid && isUnpaid && hasValidAmount;
      });
      
      // Role-based filtering - same logic as PlayerCharges component
      let hasRelevantCharges = unpaidCharges.length > 0;
      
      if (!(isAdmin || isOwner) && assignedPlayer) {
        // For regular users, only show if they have charges
        const assignedPlayerName = assignedPlayer.name || `${assignedPlayer.firstName} ${assignedPlayer.lastName}`;
        const userCharges = unpaidCharges.filter((c: any) => c.playerName === assignedPlayerName);
        hasRelevantCharges = userCharges.length > 0;
      } else if (!(isAdmin || isOwner) && !assignedPlayer) {
        // User not assigned to any player, no charges to show
        hasRelevantCharges = false;
      }
      
      setHasCharges(hasRelevantCharges);
      console.log('💳 HomePage - Provisional charges check:', {
        totalUnpaidCharges: unpaidCharges.length,
        hasRelevantCharges,
        isAdmin: isAdmin || isOwner,
        assignedPlayer: assignedPlayer?.name
      });
    } catch (error) {
      console.error('❌ HomePage - Error checking provisional charges:', error);
      setHasCharges(false);
    }
  }, [isAdmin, isOwner, assignedPlayer]);

  // Fix navigation freezing issue - refresh state when page gains focus
  useFocusEffect(
    useCallback(() => {
      console.log('🏠 HomePage - Screen focused, refreshing state');
      console.log('🏠 HomePage - Current organization:', organization?.name, 'logoUrl:', organization?.logoUrl ? 'present' : 'none');
      
      // Reset any modal states that might cause freezing
      setShowMenu(false);
      setResetModalVisible(false);
      setShowQR(false);
      
      // Check for charges using provisional overlay system (offline-first)
      checkChargesExistence();
      
      // Force a small re-render to unfreeze the UI
      const timeoutId = setTimeout(() => {
        console.log('🏠 HomePage - State refresh completed');
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }, [isAdmin, isOwner, user, organization?.name, organization?.logoUrl, assignedPlayer]) // More specific dependencies
  );



  const handleReset = () => {
    setResetModalVisible(true);
  };

  const confirmReset = async () => {
    if (confirmationCode === resetCode) {
      try {
        console.log('� RESET APP - Starting comprehensive app reset via offline-first architecture');
        
        // 1. Clear sync queue to prevent orphaned operations
        await hybridSyncService.clearSyncQueue();
        console.log('✅ RESET APP - Sync queue cleared');
        
        // 2. Delete all products via unified deleteEntity system
        console.log('🗑️ RESET APP - Deleting all products...');
        const products = await hybridSyncService.getProducts();
        for (const product of products) {
          try {
            await hybridSyncService.deleteEntity('products', product.id);
            console.log(`✅ Deleted product: ${product.name} (${product.id})`);
          } catch (error) {
            console.warn(`⚠️ Failed to delete product ${product.id}, will remove locally:`, error);
            // If server delete fails, remove from local storage anyway
            await hybridSyncService.removeFromLocalCache('products', product.id);
          }
        }
        console.log(`✅ RESET APP - Processed ${products.length} products`);
        
        // 3. Delete all assignments via unified deleteEntity system
        console.log('🗑️ RESET APP - Deleting all assignments...');
        const assignments = await hybridSyncService.getAssignments();
        for (const assignment of assignments) {
          if (assignment.id) {
            try {
              await hybridSyncService.deleteEntity('assignments', assignment.id);
              console.log(`✅ Deleted assignment: ${assignment.id}`);
            } catch (error) {
              console.warn(`⚠️ Failed to delete assignment ${assignment.id}, will remove locally:`, error);
              // If server delete fails, remove from local storage anyway
              await hybridSyncService.removeFromLocalCache('assignments', assignment.id);
            }
          }
        }
        console.log(`✅ RESET APP - Processed ${assignments.length} assignments`);
        
        // 4. Delete all players completely
        console.log('�️ RESET APP - Deleting all players...');
        const playersToDelete = await hybridSyncService.getPlayers();
        for (const player of playersToDelete) {
          try {
            await hybridSyncService.deleteEntity('players', player.id);
            console.log(`✅ Deleted player: ${player.name || player.id}`);
          } catch (error) {
            console.warn(`⚠️ Failed to delete player ${player.id}, will remove locally:`, error);
            // If server delete fails, remove from local storage anyway
            await hybridSyncService.removeFromLocalCache('players', player.id);
          }
        }
        console.log(`✅ RESET APP - Processed ${playersToDelete.length} players`);
        
        // 5. Force clear all local collections as backup
        console.log('🧹 RESET APP - Force clearing all local collections...');
        await hybridSyncService.forceEmptyLocalCollection('products');
        await hybridSyncService.forceEmptyLocalCollection('assignments');
        await hybridSyncService.forceEmptyLocalCollection('players');
        console.log('✅ RESET APP - Local collections force cleared');
        
        // 6. Clear local cache data
        console.log('🧹 RESET APP - Clearing local cache...');
        await AsyncStorage.removeItem('reportData');
        await AsyncStorage.removeItem('topSelling');
        await AsyncStorage.removeItem('salesSummary');
        console.log('✅ RESET APP - Local cache cleared');
        
        // 7. Wait for sync to complete if online
        const isOnline = await hybridSyncService.refreshNetworkState();
        if (isOnline) {
          console.log('🔄 RESET APP - Waiting for sync to complete...');
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds for sync
        } else {
          console.log('⚠️ RESET APP - Offline - data will sync when connection restored');
        }
        
        // 8. Final cleanup - clear sync queue
        await hybridSyncService.clearSyncQueue();
        console.log('✅ RESET APP - Final sync queue cleanup complete');
        
        setResetModalVisible(false);
        setConfirmationCode('');
        Alert.alert(
          'Reset Complete', 
          'VMStock app has been completely reset!\n\n' +
          '✅ All products deleted (server + local)\n' +
          '✅ All assignments/sales deleted (server + local)\n' +
          '✅ All player balances reset to 0\n' +
          '✅ All player stats reset (totalSpent, totalPurchases)\n' +
          '✅ Local cache cleared\n' +
          '✅ Sync queue cleared\n' +
          '🔒 Staff users preserved\n\n' +
          'The app is ready for fresh use with existing staff accounts.'
        );
        
        console.log('🚀 RESET APP - Comprehensive reset completed successfully!');
      } catch (error) {
        console.error('❌ RESET APP - Reset error:', error);
        Alert.alert('Error', 'Failed to reset the app via offline-first architecture. Please try again.');
      }
    } else {
      Alert.alert('Invalid Code', 'The code you entered is incorrect.');
    }
  };

  const handleResetSalesData = async () => {
    Alert.alert(
      'Reset Sales Data',
      'This will remove all sales and report information but keep products and users. Are you sure?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              // ENHANCED RESET: Using new bundle-aware reset method

              console.log('� Starting ENHANCED sales data reset...');
              
              await hybridSyncService.resetAllSalesData();
              
              Alert.alert('Reset Complete', 'All sales data has been cleared!\n\n✅ All assignments deleted (server + local)\n✅ Player balances reset to 0\n✅ Player stats reset (totalSpent, totalPurchases)\n✅ Sync queue + dead letter + provisional data cleared\n✅ Local cache cleared\n\nProducts and staff users preserved.\n\n🚀 Fresh start with bundle system!');
              
            } catch (error) {
              console.error('❌ Enhanced sales reset error:', error);
              Alert.alert('Error', 'Failed to reset sales data. Some data may have been cleared. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleCleanupSyncQueue = async () => {
    Alert.alert(
      'Clean Sync Queue',
      'This will remove orphaned sync operations that reference non-existent products. This might fix sync issues.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clean',
          style: 'default',
          onPress: async () => {
            try {
              console.log('🧹 Starting ENHANCED sync cleanup...');
              
              // Use the new enhanced cleanup that handles stuck data + bundle system
              await hybridSyncService.clearAllStuckData();
              
              // Clean up orphaned operations (Firebase existence check)
              await hybridSyncService.cleanupOrphanedOperations();
              
              // Also run the regular cleanup
              await hybridSyncService.removeOrphanedSyncItems();
              await hybridSyncService.cleanupSyncQueue();
              
              Alert.alert('Cleanup Complete', 'All stuck sync data cleared!\n\n✅ Sync queue cleared\n✅ Dead letter queue cleared\n✅ Provisional data cleared\n✅ Orphaned items removed\n✅ Firebase orphaned operations cleaned\n\n🚀 Fresh sync state ready!');
            } catch (error) {
              console.error('❌ Enhanced sync cleanup error:', error);
              Alert.alert('Error', 'Failed to clean sync queue. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleSyncStatus = async () => {
    try {
      const status = hybridSyncService.getDetailedSyncStatus();
      const auth = FirebaseAuth;
      const currentUser = auth.currentUser;
      
      Alert.alert(
        'Background Sync Status',
        `🌐 Online: ${status.isOnline}
🔄 Currently Syncing: ${status.isSyncing}
📤 Queue Items: ${status.mainQueueLength}
💀 Dead Letter Queue: ${status.deadLetterQueueLength}
✅ Processed Items: ${status.processedIdsCount}
🔄 Retry Items: ${status.pendingRetry}
👤 User Authenticated: ${!!currentUser}
📊 Status: ${status.status}

Last Check: ${new Date().toLocaleTimeString()}`,
        [
          {
            text: 'Force Sync Now',
            onPress: async () => {
              try {
                await hybridSyncService.forcSync();
                Alert.alert('Success', 'Manual sync completed!');
              } catch (error: any) {
                Alert.alert('Error', 'Manual sync failed: ' + (error?.message || error));
              }
            }
          },
          { text: 'OK', style: 'default' }
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', 'Failed to get sync status: ' + (error?.message || error));
    }
  };

  const handleLogout = async () => {
    // Check if there's unsynced data first
    try {
      const isSafe = await hybridSyncService.isSafeToLogout();
      if (isSafe) {
        // No unsynced data - show simple confirmation
        Alert.alert(
          'Sign Out',
          'Are you sure you want to sign out?',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Sign Out',
              style: 'destructive',
              onPress: async () => {
                try {
                  await logout(false); // Safe logout
                } catch (error) {
                  Alert.alert('Error', 'Failed to sign out. Please try again.');
                }
              },
            },
          ]
        );
      } else {
        // Has unsynced data - show detailed modal
        setShowLogoutModal(true);
      }
    } catch (error) {
      console.error('Failed to check logout safety:', error);
      // Fallback to simple logout on error
      Alert.alert(
        'Sign Out',
        'Are you sure you want to sign out?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Sign Out',
            style: 'destructive',
            onPress: async () => {
              try {
                await logout(false);
              } catch (error) {
                Alert.alert('Error', 'Failed to sign out. Please try again.');
              }
            },
          },
        ]
      );
    }
  };

  const handleLogoutConfirmation = async (forceLogout: boolean = false) => {
    try {
      setShowLogoutModal(false);
      await logout(forceLogout);
    } catch (error: any) {
      Alert.alert('Logout Failed', error.message || 'Unknown error occurred');
    }
  };

  return (
    <Pressable
      style={{ flex: 1 }}
      onPress={() => {
        setShowMenu(false);
        Keyboard.dismiss();
      }}
    >
      <SafeAreaView style={[styles.safeArea, isDarkMode && styles.darkSafeArea]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[
              styles.container,
              isLargeScreen && styles.largeContainer,
            ]}
            showsVerticalScrollIndicator={true}
            bounces={true}
          >
            {/* Menu Container - Only show for assigned users */}
            {(isAdmin || isOwner || assignedPlayer) && (
              <View style={styles.menuContainer}>
                <TouchableOpacity
                  style={styles.menuButton}
                  onPress={toggleMenu}
                >
                  <Icon name="dots-horizontal" size={24} color="#888" />
                </TouchableOpacity>
              </View>
            )}

            {/* Organization Logo - Only show for assigned users (admin/owner or with assigned player) */}
            {organization && (isAdmin || isOwner || assignedPlayer) && (
              <>
                {organization.logoUrl ? (
                  <Image
                    source={{ uri: organization.logoUrl }}
                    style={[styles.logo, isLargeScreen && styles.largeLogo]}
                    resizeMode="contain"
                  />
                ) : organization.name?.toLowerCase().includes('vale madrid') ? (
                  <Image
                    source={require('../assets/images/VM.png')}
                    style={[styles.logo, isLargeScreen && styles.largeLogo]}
                  />
                ) : null}
              </>
            )}

            {/* Organization Name - Only show for assigned users */}
            {(isAdmin || isOwner || assignedPlayer) && (
              <Text style={[styles.organizationName, isDarkMode && styles.darkText]}>
                {organization?.displayName || organization?.name || 'VMStock'}
              </Text>
            )}



            {/* Role-based content rendering */}
            {(isAdmin || isOwner) ? (
              // Admin/Owner view - Full access to sell products and manage bills
              <View style={styles.section}>
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.prominentButton,
                    isLargeScreen && styles.largeButton,
                  ]}
                  onPress={() => navigation.navigate('Assignments')}
                >
                  <Text
                    style={[
                      styles.prominentButtonText,
                      isDarkMode && styles.darkButtonText,
                    ]}
                  >
                    Sell Products
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.billingButton,
                    isLargeScreen && styles.largeButton,
                  ]}
                  onPress={() => navigation.navigate('PlayerBills')}
                >
                  <Text
                    style={[
                      styles.billingButtonText,
                      isDarkMode && styles.darkButtonText,
                    ]}
                  >
                    Player Bills
                  </Text>
                </TouchableOpacity>

                {/* Player Charges button - conditional based on provisional overlay data */}
                {hasCharges && (
                  <TouchableOpacity
                    style={[
                      styles.button,
                      styles.chargesButton,
                      isLargeScreen && styles.largeButton,
                    ]}
                    onPress={() => navigation.navigate('PlayerCharges')}
                  >
                    <Text
                      style={[
                        styles.chargesButtonText,
                        isDarkMode && styles.darkButtonText,
                      ]}
                    >
                      Player Charges
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : assignedPlayer ? (
              // Regular user with assigned player - Can buy products and see their bills
              <View style={styles.section}>
                <View style={styles.assignedPlayerInfo}>
                  <Icon name="account-check" size={24} color="#28a745" />
                  <Text style={[styles.assignedPlayerText, isDarkMode && styles.darkText]}>
                    Assigned to: {assignedPlayer.name}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.prominentButton,
                    isLargeScreen && styles.largeButton,
                  ]}
                  onPress={() => navigation.navigate('Assignments')}
                >
                  <Text
                    style={[
                      styles.prominentButtonText,
                      isDarkMode && styles.darkButtonText,
                    ]}
                  >
                    Buy Products
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.billingButton,
                    isLargeScreen && styles.largeButton,
                  ]}
                  onPress={() => navigation.navigate('PlayerBills')}
                >
                  <Text
                    style={[
                      styles.billingButtonText,
                      isDarkMode && styles.darkButtonText,
                    ]}
                  >
                    My Bills
                  </Text>
                </TouchableOpacity>

                {/* My Charges button - conditional based on provisional overlay data */}
                {hasCharges && (
                  <TouchableOpacity
                    style={[
                      styles.button,
                      styles.chargesButton,
                      isLargeScreen && styles.largeButton,
                    ]}
                    onPress={() => navigation.navigate('PlayerCharges')}
                  >
                    <Text
                      style={[
                        styles.chargesButtonText,
                        isDarkMode && styles.darkButtonText,
                      ]}
                    >
                      My Charges
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              // Regular user without assignment - Show placeholder message with refresh capability
              <View style={{ flex: 1 }}>
                {/* Header with menu button for unassigned users */}
                <View style={styles.unassignedHeader}>
                  <TouchableOpacity
                    style={styles.headerMenuButton}
                    onPress={toggleMenu}
                  >
                    <Icon name="dots-horizontal" size={24} color="#888" />
                  </TouchableOpacity>
                  <View style={styles.headerContent}>
                    <Icon name="account-question" size={28} color="#666" />
                    <View style={styles.headerText}>
                      <Text style={[styles.headerOrgName, isDarkMode && styles.darkText]}>
                        {organization?.displayName}
                      </Text>
                      <Text style={[styles.headerStatusText, isDarkMode && styles.darkSubtitle]}>
                        Account Setup Required
                      </Text>
                    </View>
                  </View>
                </View>
                
                {/* Use FlatList for better scrolling performance */}
                <View style={{ flex: 1 }}>
                  <ScrollView 
                    style={{ flex: 1 }}
                    contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 40 }}
                    showsVerticalScrollIndicator={true}
                    bounces={true}
                    scrollEventThrottle={16}
                  >
                    <Text style={[styles.setupDescription, isDarkMode && styles.darkSubtitle]}>
                      You need to be assigned to a player account by the shop admin to start buying products and viewing bills.
                    </Text>
                    
                    <View style={styles.setupSteps}>
                      <Text style={[styles.stepsTitle, isDarkMode && styles.darkText]}>
                        What happens next:
                      </Text>
                      <View style={styles.step}>
                        <Icon name="numeric-1-circle" size={20} color="#007bff" />
                        <Text style={[styles.stepText, isDarkMode && styles.darkSubtitle]}>
                          Admin creates or assigns you to a player account
                        </Text>
                      </View>
                      <View style={styles.step}>
                        <Icon name="numeric-2-circle" size={20} color="#007bff" />
                        <Text style={[styles.stepText, isDarkMode && styles.darkSubtitle]}>
                          You'll be able to view your balance and purchase items
                        </Text>
                      </View>
                      <View style={styles.step}>
                        <Icon name="numeric-3-circle" size={20} color="#007bff" />
                        <Text style={[styles.stepText, isDarkMode && styles.darkSubtitle]}>
                          All your transactions will be tracked in your account
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={[styles.refreshButton, isDarkMode && styles.darkRefreshButton]}
                      onPress={async () => {
                        console.log('🔄 User requested role refresh');
                        try {
                          // Force a role check
                          await checkUserRole();
                          Alert.alert('Refreshed', 'Your account status has been updated. If you still don\'t see your account, please contact the administrator.');
                        } catch (error) {
                          console.error('Error refreshing role:', error);
                          Alert.alert('Error', 'Failed to refresh account status. Please try again.');
                        }
                      }}
                    >
                      <Icon name="refresh" size={20} color="#fff" />
                      <Text style={styles.refreshButtonText}>Check Account Status</Text>
                    </TouchableOpacity>
                    
                    <Text style={[styles.setupHelp, isDarkMode && styles.darkSubtitle]}>
                      Please contact the shop administrator to complete your account setup.
                    </Text>
                    
                    <View style={styles.accountDetails}>
                      <View style={styles.detailRow}>
                        <Icon name="domain" size={16} color="#666" />
                        <Text style={[styles.detailText, isDarkMode && styles.darkText]}>
                          {organization?.displayName}
                        </Text>
                      </View>
                      {organization?.shopPin && (
                        <View style={styles.detailRow}>
                          <Icon name="key-variant" size={16} color="#666" />
                          <Text style={[styles.detailText, isDarkMode && styles.darkText]}>
                            PIN: {organization.shopPin}
                          </Text>
                        </View>
                      )}
                      <View style={styles.detailRow}>
                        <Icon name="email" size={16} color="#666" />
                        <Text style={[styles.detailText, isDarkMode && styles.darkText]}>
                          {user?.email}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Icon name="clock-outline" size={16} color="#orange" />
                        <Text style={[styles.detailText, { color: '#ff8c00' }]}>
                          Waiting for Assignment
                        </Text>
                      </View>
                    </View>
                  </ScrollView>
                </View>
              </View>
            )}

            <View style={styles.section}>
              {(isAdmin || isOwner) && (
                <>
                  <TouchableOpacity
                    style={[styles.button, isLargeScreen && styles.largeButton]}
                    onPress={() => navigation.navigate('Products')}
                  >
                    <Text
                      style={[styles.buttonText, isDarkMode && styles.darkButtonText]}
                    >
                      Manage Products
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.button, isLargeScreen && styles.largeButton]}
                    onPress={() => navigation.navigate('Users')}
                  >
                    <Text
                      style={[styles.buttonText, isDarkMode && styles.darkButtonText]}
                    >
                      Manage Players
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.button, isLargeScreen && styles.largeButton]}
                    onPress={() => navigation.navigate('Stock Take')}
                  >
                    <Text
                      style={[styles.buttonText, isDarkMode && styles.darkButtonText]}
                    >
                      Stock Take
                    </Text>
                  </TouchableOpacity>


                </>
              )}
            </View>

            <View style={styles.section}>
              {/* Earnings Report - Admin/Owner Only */}
              {(isAdmin || isOwner) && (
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.takingsButton,
                    isLargeScreen && styles.largeButton,
                  ]}
                  onPress={() => navigation.navigate('Reports')}
                >
                  <Text
                    style={[
                      styles.billingButtonText,
                      isDarkMode && styles.darkButtonText,
                    ]}
                  >
                    Earnings Report
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.button,
                  styles.takingsButton,
                  isLargeScreen && styles.largeButton,
                ]}
                onPress={() => navigation.navigate('Sales')}
              >
                <Text
                  style={[
                    styles.billingButtonText,
                    isDarkMode && styles.darkButtonText,
                  ]}
                >
                  Top Sales Report
                </Text>
              </TouchableOpacity>
            </View>


          </ScrollView>

          {showMenu && (
            <View style={styles.improvedMenu}>
              {/* User info */}
              <View style={[styles.menuItem, styles.userInfoItem]}>
                <Icon name="account" size={20} color="#007bff" style={styles.menuIcon} />
                <Text style={[styles.menuText, styles.userText]}>
                  {user?.displayName || user?.email || 'User'}
                </Text>
              </View>

              {/* Biometric Settings */}
              <BiometricSettings containerStyle={styles.biometricSettingsItem} />
              
              {/* Organization Settings - Admin/Owner Only */}
              {(isAdmin || isOwner) && (
                <TouchableOpacity 
                  onPress={() => {
                    console.log('🏢 HomePage - Navigating to OrganizationSettings');
                    setShowMenu(false);
                    try {
                      navigation.navigate('OrganizationSettings');
                      console.log('✅ HomePage - Navigation to OrganizationSettings completed');
                    } catch (error) {
                      console.error('❌ HomePage - Navigation error:', error);
                    }
                  }} 
                  style={styles.menuItem}
                >
                  <Icon name="store" size={20} color="#28a745" style={styles.menuIcon} />
                  <Text style={[styles.menuText, { color: '#28a745' }]}>Organization</Text>
                </TouchableOpacity>
              )}
              
              {/* Logout */}
              <TouchableOpacity onPress={handleLogout} style={styles.menuItem}>
                <Icon name="logout" size={20} color="#ff6b6b" style={styles.menuIcon} />
                <Text style={[styles.menuText, styles.logoutText]}>Sign Out</Text>
              </TouchableOpacity>
              
              {/* Divider */}
              <View style={styles.menuDivider} />
              
              {/* Owner-only debug and data management options */}
              {isOwner && (
                <>
                  <TouchableOpacity 
                    onPress={() => {
                      setShowMenu(false);
                      navigation.navigate('SyncDebug');
                    }} 
                    style={styles.menuItem}
                  >
                    <Icon name="bug" size={20} color="#ff9500" style={styles.menuIcon} />
                    <Text style={styles.menuText}>🔍 Sync Debug</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => {
                      setShowMenu(false);
                      setShowStockDebugPanel(true);
                    }} 
                    style={styles.menuItem}
                  >
                    <Icon name="package-variant" size={20} color="#ff3b30" style={styles.menuIcon} />
                    <Text style={styles.menuText}>🔧 Stock Debug</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => {
                      setShowMenu(false);
                      navigation.navigate('FirebaseAuthTest');
                    }} 
                    style={styles.menuItem}
                  >
                    <Icon name="shield-check" size={20} color="#007bff" style={styles.menuIcon} />
                    <Text style={styles.menuText}>🔐 Firebase Auth Test</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleReset} style={styles.menuItem}>
                    <Icon name="restart" size={20} color="#333" style={styles.menuIcon} />
                    <Text style={styles.menuText}>Reset App</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleResetSalesData} style={styles.menuItem}>
                    <Icon name="delete" size={20} color="#333" style={styles.menuIcon} />
                    <Text style={styles.menuText}>Reset Sales Data</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleCleanupSyncQueue} style={styles.menuItem}>
                    <Icon name="broom" size={20} color="#007bff" style={styles.menuIcon} />
                    <Text style={styles.menuText}>Clean Sync Queue</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleSyncStatus} style={styles.menuItem}>
                    <Icon name="information-outline" size={20} color="#28a745" style={styles.menuIcon} />
                    <Text style={styles.menuText}>Sync Status</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          <Modal
            visible={isResetModalVisible}
            transparent={true}
            animationType="fade"
            onRequestClose={() => setResetModalVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContainer}>
                <Text style={styles.modalTitle}>Reset App</Text>
                <Text style={styles.modalMessage}>Enter the code to confirm:</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Enter code"
                  value={confirmationCode}
                  onChangeText={setConfirmationCode}
                  secureTextEntry
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setResetModalVisible(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.resetButton} onPress={confirmReset}>
                    <Text style={styles.resetButtonText}>Reset</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>


          {/* QR Code Modal - Rendered at top level to avoid z-index issues */}
          <Modal visible={showQR} animationType="fade" transparent>
            <View style={styles.qrOverlay}>
              <View style={[styles.qrModal, isDarkMode && styles.darkQrModal]}>
                <View style={styles.qrHeader}>
                  <Text style={[styles.qrTitle, isDarkMode && styles.darkText]}>
                    Organization QR Code
                  </Text>
                  <TouchableOpacity onPress={() => setShowQR(false)}>
                    <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#333'} />
                  </TouchableOpacity>
                </View>
                
                {organization && (
                  <View style={styles.qrCodeContainer}>
                    <QRCode
                      value={generateQRData()}
                      size={200}
                      color={isDarkMode ? '#000' : '#000'}
                      backgroundColor={isDarkMode ? '#fff' : '#fff'}
                    />
                  </View>
                )}
                
                <Text style={[styles.qrInstructions, isDarkMode && styles.darkSubtext]}>
                  Scan this QR code when setting up VMStock to automatically join "{organization?.displayName}"
                </Text>

                <View style={styles.qrActions}>
                  <TouchableOpacity
                    onPress={handleShareQR}
                    style={[styles.qrActionButton, styles.shareButton]}
                  >
                    <Icon name="share-variant" size={20} color="#fff" />
                    <Text style={styles.qrActionButtonText}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Logout Confirmation Modal */}
          <LogoutConfirmationModal
            visible={showLogoutModal}
            onCancel={() => setShowLogoutModal(false)}
            onConfirmLogout={handleLogoutConfirmation}
          />

          {/* Stock Debug Panel */}
          <StockDebugPanel
            visible={showStockDebugPanel}
            onClose={() => setShowStockDebugPanel(false)}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Pressable>
  );
}


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9f9f9',
  },
  darkSafeArea: {
    backgroundColor: '#1a1a1a',
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 20,
    paddingBottom: 100, // Extra space at bottom for scrolling
  },
  largeContainer: {
    padding: 30,
  },
  organizationName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  darkText: {
    color: '#fff',
  },
  logo: {
    width: 150,
    height: 150,
    marginTop: 20,
    marginBottom: 20,
  },
  largeLogo: {
    width: 250,
    height: 250,
    marginBottom: 30,
  },
  section: {
    marginVertical: 10,
    alignItems: 'center',
    width: '100%',
  },
  button: {
    backgroundColor: '#007bff',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 5,
    marginBottom: 15,
    width: '80%',
    alignItems: 'center',
  },
  largeButton: {
    width: '60%',
  },
  prominentButton: {
    backgroundColor: '#28a745',
    borderWidth: 2,
    borderColor: '#1e7e34',
  },
  prominentButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  billingButton: {
    backgroundColor: '#ffc107',
    borderWidth: 2,
    borderColor: '#e28743',
  },
  chargesButton: {
    backgroundColor: '#dc3545',
    borderWidth: 2,
    borderColor: '#c82333',
  },
  takingsButton: {
    backgroundColor: '#76b5c5',
    borderWidth: 2,
    borderColor: '#0767a2',
  },
  testButton: {
    backgroundColor: '#FF9800',
    borderWidth: 2,
    borderColor: '#F57C00',
  },

  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  billingButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: 'bold',
  },
  chargesButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  darkButtonText: {
    color: '#fff',
  },
  fixedMenuButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10, // Ensure it's above other content
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Slightly transparent background
    borderRadius: 20, // Circular button
    elevation: 3, // Shadow for Android
    shadowColor: '#000', // Shadow for iOS
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  menuContainer: {
    alignItems: 'flex-end',
    width: '100%',
    paddingHorizontal: 10,
    marginTop: 10,
  },
  menuButton: {
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Slightly transparent background
    borderRadius: 20, // Circular button
    elevation: 3, // Shadow for Android
    shadowColor: '#000', // Shadow for iOS
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },

  improvedMenu: {
    position: 'absolute',
    top: 60, // Below the menu button
    right: 10, // Align with the menu button
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    width: '60%', // Reduced width
    maxWidth: 250,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  menuIcon: {
    marginRight: 10, // Space between icon and text
  },
  menuText: {
    fontSize: 18,
    fontWeight: '500',
    color: '#333',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '80%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 16,
    marginBottom: 15,
    textAlign: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    marginBottom: 15,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: 'gray',
    padding: 10,
    marginRight: 5,
    borderRadius: 5,
    alignItems: 'center',
  },
  resetButton: {
    flex: 1,
    backgroundColor: 'red',
    padding: 10,
    marginLeft: 5,
    borderRadius: 5,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resetButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userInfoItem: {
    backgroundColor: '#f0f8ff',
    borderRadius: 5,
    marginBottom: 5,
  },
  biometricSettingsItem: {
    marginHorizontal: 0,
    marginVertical: 4,
    borderRadius: 5,
  },
  userText: {
    color: '#007bff',
    fontWeight: 'bold',
  },
  logoutText: {
    color: '#ff6b6b',
    fontWeight: 'bold',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 5,
  },
  syncButton: {
    backgroundColor: '#4CAF50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  syncBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FF4444',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  syncBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  syncModalContainer: {
    width: '90%',
    maxHeight: '80%',
    minHeight: 400,
  },
  syncModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  closeButton: {
    padding: 5,
  },
  syncModalContent: {
    flex: 1,
  },
  // QR Code Modal Styles
  qrOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  qrModal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 350,
  },
  darkQrModal: {
    backgroundColor: '#333',
  },
  qrHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  qrCodeContainer: {
    alignItems: 'center',
    marginBottom: 20,
    padding: 20,
  },
  qrInstructions: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  darkSubtext: {
    color: '#ccc',
  },
  qrActions: {
    gap: 10,
  },
  qrActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  shareButton: {
    backgroundColor: '#007bff',
  },
  qrActionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userInfoCard: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  darkUserInfoCard: {
    backgroundColor: '#333',
    borderColor: '#555',
  },
  userInfoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  userInfoText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 4,
  },
  lowBalanceText: {
    fontSize: 14,
    color: '#dc3545',
    fontStyle: 'italic',
  },
  // Role-based UI styles
  assignedPlayerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e8',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#28a745',
  },
  assignedPlayerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#28a745',
    marginLeft: 8,
  },
  placeholderSection: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 32,
    marginVertical: 20,
    borderWidth: 2,
    borderColor: '#e9ecef',
    borderStyle: 'dashed',
  },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 12,
    textAlign: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 16,
  },
  placeholderSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  contactInfo: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    width: '100%',
  },
  contactLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 4,
  },
  darkSubtitle: {
    color: '#aaa',
  },
  // Enhanced placeholder styles
  setupSteps: {
    marginVertical: 20,
    paddingHorizontal: 10,
  },
  stepsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  stepText: {
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
    color: '#666',
  },
  refreshButton: {
    backgroundColor: '#007bff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginVertical: 20,
  },
  darkRefreshButton: {
    backgroundColor: '#0056b3',
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  // Compact header for unassigned users
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  compactHeaderText: {
    marginLeft: 12,
    flex: 1,
  },
  compactOrgName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  compactStatusText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  setupContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  setupDescription: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  setupHelp: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginVertical: 16,
    fontStyle: 'italic',
  },
  accountDetails: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#333',
    marginLeft: 8,
    flex: 1,
  },
  // Header styles for unassigned users
  unassignedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    zIndex: 10,
    elevation: 2,
  },
  headerMenuButton: {
    padding: 10,
    marginRight: 12,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  headerOrgName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  headerStatusText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
});
