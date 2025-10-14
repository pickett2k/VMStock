import React, { useEffect, useState, useCallback } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions, 
  Modal, 
  ScrollView,
  Alert
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../app/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { hybridSyncService } from '../services/HybridSyncService';
import { useOrganization } from '../contexts/OrganizationContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Platform } from 'react-native';
import { formatUKDateTime } from '../utils/dateUtils';
import { formatCurrency } from '../utils/currency';

// Conditional Stripe imports to prevent web bundling issues
let stripePaymentService: any = null;
type StripePaymentRequest = any;
type StripePaymentResult = any;

if (Platform.OS !== 'web') {
  try {
    const stripe = require('../services/StripePaymentService');
    stripePaymentService = stripe.stripePaymentService;
  } catch (error) {
    console.warn('Stripe service not available:', error);
  }
}

// Environment variable check for Stripe feature flag
const STRIPE_ENABLED = process.env.STRIPE_ENABLED === 'true';

const { width } = Dimensions.get('window');

interface Assignment {
  user?: string; // Legacy field
  playerName?: string; // New field
  userName?: string; // Firebase field
  product?: string;
  productName?: string;
  quantity: number;
  amount?: number; // Current field used in Firebase
  total?: number; // Legacy field
  totalAmount?: number; // New field
  date: string; // Date in DD.MM.YYYY format
  paid: boolean; // Property to indicate if the assignment is paid
  id?: string;
}

interface PlayerTotal {
  name: string;
  total: number;
  assignments: Assignment[];
  playerId?: string; // Add player ID for balance updates
}

export default function PlayerBills() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [playerTotals, setPlayerTotals] = useState<PlayerTotal[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerTotal | null>(null);
  const [showBreakdownModal, setShowBreakdownModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentPlayer, setPaymentPlayer] = useState<PlayerTotal | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const { isDarkMode } = useTheme();
  const { isAdmin, assignedPlayer } = useAuth();
  const { organization } = useOrganization();

  const loadAssignments = async () => {
    try {
      const [assignments, playersData] = await Promise.all([
        hybridSyncService.getAssignmentsWithOverlay(), // Use overlay to show provisional assignments
        hybridSyncService.getPlayersWithOverlay() // Use overlay to show provisional balance changes
      ]);
      
      console.log('💰 PlayerBills loaded with overlays:', {
        assignments: assignments.length,
        players: playersData.length
      });
      
      setPlayers(playersData);
      
      // Filter out assignments with invalid data and only get unpaid ones
      const validAssignments = assignments.filter((a: any) => {
        const playerName = a.playerName || a.userName || a.user;
        const isValid = playerName && playerName !== 'Unknown Player' && playerName.trim() !== '';
        const isUnpaid = !a.paid;
        
        if (a._provisional) {
          console.log('💰 Processing provisional assignment:', {
            id: a.id,
            playerName,
            paid: a.paid,
            isValid,
            isUnpaid,
            willInclude: isValid && isUnpaid
          });
        }
        
        return isValid && isUnpaid;
      });
      
      console.log('💰 Assignment filtering results:', {
        totalAssignments: assignments.length,
        validUnpaidAssignments: validAssignments.length,
        provisionalCount: assignments.filter((a: any) => a._provisional).length
      });
      
      setAssignments(validAssignments);
    } catch (error) {
      console.error('Error loading bills:', error);
      Alert.alert('Error', 'Failed to load bills. Please try again.');
    }
  };

  const calculatePlayerTotals = (assignmentsToCalculate: Assignment[], playersData: any[] = []) => {
    const playerMap: { [key: string]: PlayerTotal } = {};

    assignmentsToCalculate.forEach((assignment) => {
      const playerName = assignment.playerName || assignment.userName || assignment.user;
      
      // Skip assignments with empty/invalid player names
      if (!playerName || playerName.trim() === '' || playerName === 'Unknown') {
        return;
      }
      
      const amount = assignment.total || assignment.amount || assignment.totalAmount || 0;
      const validAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
      
      if (!playerMap[playerName]) {
        // Find the player ID from the players data
        const playerData = playersData.find(p => 
          p.name === playerName || 
          `${p.firstName} ${p.lastName}` === playerName
        );
        
        playerMap[playerName] = {
          name: playerName,
          total: 0,
          assignments: [],
          playerId: playerData?.id
        };
      }
      
      playerMap[playerName].total += validAmount;
      playerMap[playerName].assignments.push(assignment);
    });



    // Convert to array and sort by total (highest first)
    let playerTotalsArray = Object.values(playerMap)
      .filter(player => player.total > 0)
      .sort((a, b) => b.total - a.total);

    // Role-based filtering
    if (!isAdmin && assignedPlayer) {
      // For regular users, only show their assigned player's bills
      const assignedPlayerName = assignedPlayer.name || 
        `${assignedPlayer.firstName} ${assignedPlayer.lastName}`.trim() ||
        assignedPlayer.firstName ||
        assignedPlayer.id;
      
      playerTotalsArray = playerTotalsArray.filter(player => 
        player.name === assignedPlayerName
      );
      
      console.log('👤 UserSummary: Filtered for regular user, showing bills for:', assignedPlayerName);
    } else if (isAdmin) {
      console.log('👑 UserSummary: Admin view, showing all player bills');
    } else {
      // User not assigned to any player, show empty list
      playerTotalsArray = [];
      console.log('🚫 UserSummary: User not assigned to any player, showing no bills');
    }

    setPlayerTotals(playerTotalsArray);
  };

  const handleMarkAllPaid = (player: PlayerTotal) => {
    if (STRIPE_ENABLED) {
      // Use Stripe payment processing
      handleStripePayment(player);
    } else {
      // Use legacy manual payment confirmation
      setPaymentPlayer(player);
      setShowPaymentModal(true);
    }
  };

  const handleManualMarkPaid = (player: PlayerTotal) => {
    // Show confirmation to prevent accidental marking as paid
    Alert.alert(
      'Mark as Paid',
      `Are you sure you want to mark ${player.name} as fully paid?\n\nAmount: ${formatCurrency(player.total, organization?.currency || 'GBP')}\nItems: ${player.assignments.length}`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Mark Paid',
          style: 'destructive',
          onPress: () => {
            setPaymentPlayer(player);
            setShowPaymentModal(true);
          }
        }
      ]
    );
  };

  const handleStripePayment = async (player: PlayerTotal) => {
    try {
      // Check platform restriction - Stripe wallet only available on Android
      if (Platform.OS !== 'android') {
        Alert.alert(
          'Payment Not Available',
          'Stripe wallet payments are only available on Android devices.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Check if organization has Stripe payment enabled
      if (!organization?.settings?.features?.enableStripePayments) {
        Alert.alert(
          'Payment Not Available',
          `Stripe wallet payments are not enabled for ${organization?.displayName || 'this organization'}.`,
          [{ text: 'OK' }]
        );
        return;
      }

      setProcessingPayment(true);
      
      // Initialize Stripe if not already done
      const initStatus = stripePaymentService.getInitializationStatus();
      if (!initStatus.isInitialized) {
        await stripePaymentService.initialize();
      }

      // Create Stripe payment request
      const paymentRequest: StripePaymentRequest = {
        amount: Math.round(player.total * 100), // Convert to pence
        currency: 'gbp',
        description: `VMStock payment for ${player.name}`,
        metadata: {
          playerName: player.name,
          itemCount: player.assignments.length.toString(),
          source: 'player_bills'
        }
      };

      console.log(`💳 Processing Stripe payment for ${player.name}: ${formatCurrency(player.total, organization?.currency || 'GBP')}`);

      // Process payment using Stripe (uses manual entry with test card)
      const result: StripePaymentResult = await stripePaymentService.processManualEntry(paymentRequest);

      if (result.success) {
        // Use atomic payment bundle for consistency and reliability
        const assignmentIds = player.assignments
          .filter(a => a.id)
          .map(a => a.id!);
        
        if (assignmentIds.length > 0 && player.playerId) {
          console.log('💰 Processing Stripe payment with atomic bundle:', {
            playerId: player.playerId,
            playerName: player.name,
            assignmentCount: assignmentIds.length,
            totalAmount: player.total,
            paymentMethod: 'stripe'
          });
          
          await hybridSyncService.createPaymentBundle({
            playerId: player.playerId,
            playerName: player.name,
            assignmentIds,
            totalAmount: player.total,
            paymentMethod: 'stripe'
          });
        }

        // Reload assignments to update the UI
        await loadAssignments();

        Alert.alert(
          'Payment Successful! 🎉',
          `✅ ${formatCurrency(player.total, organization?.currency || 'GBP')} payment completed successfully\n\n` +
          `Payment ID: ${result.paymentIntentId}\n` +
          `Player: ${player.name}\n` +
          `Items: ${player.assignments.length}\n\n` +
          `All items have been marked as paid!`,
          [{ text: 'View in Dashboard', onPress: () => console.log('Open Stripe Dashboard') },
           { text: 'OK', style: 'default' }]
        );
      } else {
        Alert.alert('Payment Failed', result.error || 'Payment could not be processed');
      }

    } catch (error) {
      console.error('Error processing Stripe payment:', error);
      Alert.alert('Payment Error', 'Failed to process payment. Please try again.');
    } finally {
      setProcessingPayment(false);
    }
  };

  const confirmMarkAllPaid = async () => {
    if (!paymentPlayer) return;
    
    try {
      // NEW: Use bundle-based payment processing for atomic operations
      const assignmentIds = paymentPlayer.assignments
        .filter(a => a.id)
        .map(a => a.id!);
      
      if (assignmentIds.length === 0) {
        Alert.alert('Error', 'No valid assignments found to mark as paid.');
        return;
      }

      console.log('💰 Processing payment bundle:', {
        playerId: paymentPlayer.playerId,
        playerName: paymentPlayer.name,
        assignmentCount: assignmentIds.length,
        totalAmount: paymentPlayer.total
      });
      
      // Create payment bundle for atomic transaction
      const bundleId = await hybridSyncService.createPaymentBundle({
        playerId: paymentPlayer.playerId!,
        playerName: paymentPlayer.name,
        assignmentIds: assignmentIds,
        totalAmount: paymentPlayer.total,
        paymentMethod: 'manual'
      });
      
      console.log('✅ Payment bundle created:', bundleId);
      
      setShowPaymentModal(false);
      setPaymentPlayer(null);
      await loadAssignments();
      
      Alert.alert('Success', `${paymentPlayer.name} has been marked as fully paid!\n\nBundle: ${bundleId}`);
    } catch (error) {
      console.error('Error marking all as paid:', error);
      Alert.alert('Error', 'Failed to update payment status. Please try again.');
    }
  };

  const handleViewBreakdown = (player: PlayerTotal) => {
    console.log('📋 Opening breakdown for:', player.name);
    console.log('📋 Player assignments:', player.assignments.length);
    player.assignments.forEach((assignment, index) => {
      console.log(`📋 Assignment ${index + 1}:`, {
        product: assignment.productName || assignment.product,
        quantity: assignment.quantity,
        amount: assignment.total || assignment.amount || assignment.totalAmount,
        date: assignment.date,
        paid: assignment.paid
      });
    });
    setSelectedPlayer(player);
    setShowBreakdownModal(true);
  };

  const handleDeleteAssignment = async (assignment: Assignment) => {
    // Get item details for confirmation
    const productName = assignment.product || assignment.productName || 'Unknown Product';
    const amount = assignment.total || assignment.amount || assignment.totalAmount || 0;
    const validAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
    const quantity = assignment.quantity || 1;
    
    // Show confirmation to prevent accidental deletion
    Alert.alert(
      'Delete Assignment',
      `Are you sure you want to delete this assignment?\n\n${quantity}x ${productName}\nAmount: ${formatCurrency(validAmount, organization?.currency || 'GBP')}\n\nThis will:\n• Remove the assignment\n• Refund the player's balance\n• Restore product stock\n• Remove from purchase history`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Use the same deletion logic as AssignmentsPage
              console.log('🗑️ UserSummary: Deleting assignment via HybridSyncService:', assignment.id);
              
              if (!assignment.id) {
                throw new Error('Assignment ID is required for deletion');
              }
              
              await hybridSyncService.deleteEntity('assignments', assignment.id);
              
              // Refresh the data to show changes
              await loadAssignments();
              
              // Close modal if no more assignments for this player
              if (selectedPlayer) {
                const updatedPlayer = playerTotals.find(p => p.name === selectedPlayer.name);
                if (!updatedPlayer || updatedPlayer.assignments.length === 0) {
                  setShowBreakdownModal(false);
                  setSelectedPlayer(null);
                }
              }
              
              console.log('✅ UserSummary: Assignment deleted successfully');
            } catch (error) {
              console.error('❌ UserSummary: Failed to delete assignment:', error);
              Alert.alert('Error', 'Failed to delete assignment. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleMarkIndividualPaid = async (assignment: Assignment) => {
    // Get item details for confirmation
    const productName = assignment.product || assignment.productName || 'Unknown Product';
    const amount = assignment.total || assignment.amount || assignment.totalAmount || 0;
    const validAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
    const quantity = assignment.quantity || 1;
    
    // Show confirmation to prevent accidental marking as paid
    Alert.alert(
      'Mark Item as Paid',
      `Are you sure you want to mark this item as paid?\n\n${quantity}x ${productName}\nAmount: ${formatCurrency(validAmount, organization?.currency || 'GBP')}`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Mark Paid',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!assignment.id || !selectedPlayer?.playerId) {
                Alert.alert('Error', 'Missing assignment or player information.');
                return;
              }

              console.log('💰 Processing individual payment bundle:', {
                assignmentId: assignment.id,
                playerId: selectedPlayer.playerId,
                playerName: selectedPlayer.name,
                amount: validAmount
              });
              
              // NEW: Use bundle-based payment processing for individual items
              const bundleId = await hybridSyncService.createPaymentBundle({
                playerId: selectedPlayer.playerId,
                playerName: selectedPlayer.name,
                assignmentIds: [assignment.id],
                totalAmount: validAmount,
                paymentMethod: 'manual'
              });
              
              console.log('✅ Individual payment bundle created:', bundleId);
              
              // Update the selected player's assignments in real-time
              if (selectedPlayer) {
                const updatedAssignments = selectedPlayer.assignments.filter(a => a.id !== assignment.id);
                const updatedTotal = updatedAssignments.reduce((sum, a) => {
                  const amount = a.total || a.amount || a.totalAmount || 0;
                  return sum + (typeof amount === 'number' && !isNaN(amount) ? amount : 0);
                }, 0);
                
                setSelectedPlayer({
                  ...selectedPlayer,
                  assignments: updatedAssignments,
                  total: updatedTotal
                });
              }
              
              await loadAssignments();
              
              // Show success message
              Alert.alert('Success', `${quantity}x ${productName} has been marked as paid!\n\nBundle: ${bundleId}`);
            } catch (error) {
              console.error('Error marking individual item as paid:', error);
              Alert.alert('Error', 'Failed to update payment status. Please try again.');
            }
          }
        }
      ]
    );
  };

  useEffect(() => {
    loadAssignments();
  }, []);

  // Recalculate totals when assignments or players change
  useEffect(() => {
    calculatePlayerTotals(assignments, players);
  }, [assignments, players, isAdmin, assignedPlayer]);

  // Refresh data when screen gains focus (e.g., after syncing)
  useFocusEffect(
    useCallback(() => {
      console.log('💰 PlayerBills screen focused - refreshing assignment data');
      loadAssignments();
    }, [])
  );

  const renderPlayerItem = ({ item }: { item: PlayerTotal }) => (
    <View style={[styles.playerCard, isDarkMode && styles.darkPlayerCard]}>
      <View style={styles.playerInfo}>
        <Text style={[styles.playerName, isDarkMode && styles.darkPlayerName]}>
          {item.name}
        </Text>
        <Text style={[styles.playerAmount, isDarkMode && styles.darkPlayerAmount]}>
          {formatCurrency(item.total, organization?.currency || 'GBP')} • {item.assignments.length} item{item.assignments.length !== 1 ? 's' : ''}
        </Text>
      </View>
      <View style={styles.actionIcons}>
        {/* Breakdown Icon */}
        <TouchableOpacity
          style={[styles.iconButton, styles.breakdownIcon, isDarkMode && styles.darkBreakdownIcon]}
          onPress={() => handleViewBreakdown(item)}
        >
          <Icon name="eye" size={18} color={isDarkMode ? '#fff' : '#007AFF'} />
        </TouchableOpacity>
        
        {/* Admin-only payment controls */}
        {isAdmin && (
          <>
            {/* Stripe Payment Icon (if enabled, Android only, and Vale Madrid organization only) */}
            {STRIPE_ENABLED && Platform.OS === 'android' && organization?.settings?.features?.enableStripePayments && (
              <TouchableOpacity
                style={[styles.iconButton, styles.stripeIcon, processingPayment && styles.disabledButton]}
                onPress={() => handleStripePayment(item)}
                disabled={processingPayment}
              >
                <Icon name="credit-card" size={18} color="#fff" />
              </TouchableOpacity>
            )}
            
            {/* Manual Mark Paid Icon (always available for offline scenarios) */}
            <TouchableOpacity
              style={[styles.iconButton, styles.markPaidIcon, isDarkMode && styles.darkMarkPaidIcon]}
              onPress={() => handleManualMarkPaid(item)}
            >
              <Icon name="check-circle" size={18} color="#fff" />
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  const renderBreakdownItem = ({ item }: { item: Assignment }) => {
    console.log('🚀 renderBreakdownItem called with:', item);
    
    // Handle different property names for amount - based on logs, 'total' is the correct field
    const amount = item.total || item.amount || item.totalAmount || 0;
    const validAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
    
    // Handle different property names for product
    const productName = item.product || item.productName || 'Unknown Product';
    const quantity = item.quantity || 1;
    const date = item.date ? formatUKDateTime(item.date) : ((item as any).createdAt ? formatUKDateTime((item as any).createdAt) : 'No Date');
    const isPaid = item.paid || false;
    
    console.log('🔧 Rendering breakdown item:', { 
      productName, 
      quantity, 
      amount: validAmount, 
      date, 
      isPaid,
      rawItem: item 
    });
    
    console.log('🎯 About to return JSX for:', productName);
    
    return (
      <View style={[styles.breakdownItem, isDarkMode && styles.darkBreakdownItem]}>
        <View style={styles.breakdownInfo}>
          <Text style={[styles.breakdownProduct, isDarkMode && styles.darkBreakdownProduct]}>
            {quantity}x {productName}
          </Text>
          <Text style={[styles.breakdownDate, isDarkMode && styles.darkBreakdownDate]}>
            {date} {isPaid ? '(Paid)' : '(Unpaid)'}
          </Text>
        </View>
        <View style={styles.breakdownRight}>
          <Text style={[styles.breakdownAmount, isDarkMode && styles.darkBreakdownAmount]}>
            {formatCurrency(validAmount, organization?.currency || 'GBP')}
          </Text>
          {!isPaid && isAdmin && (
            <TouchableOpacity
              style={[styles.itemPaidButton, isDarkMode && styles.darkItemPaidButton]}
              onPress={() => handleMarkIndividualPaid(item)}
            >
              <Icon name="check" size={14} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      {/* Header */}
      <View style={[styles.header, isDarkMode && styles.darkHeader]}>
        <Icon name="receipt" size={24} color={isDarkMode ? '#fff' : '#333'} />
        <Text style={[styles.headerTitle, isDarkMode && styles.darkHeaderTitle]}>
          Player Bills
        </Text>
        {STRIPE_ENABLED && (
          <View style={styles.stripeIndicator}>
            <Icon name="credit-card" size={16} color="#635BFF" />
            <Text style={styles.stripeIndicatorText}>Stripe Enabled</Text>
          </View>
        )}
      </View>

      {/* Player List */}
      {playerTotals.length > 0 ? (
        <FlatList
          data={playerTotals}
          renderItem={renderPlayerItem}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Icon name="check-circle-outline" size={64} color={isDarkMode ? '#666' : '#ccc'} />
          <Text style={[styles.emptyTitle, isDarkMode && styles.darkEmptyTitle]}>
            All Paid Up!
          </Text>
          <Text style={[styles.emptySubtitle, isDarkMode && styles.darkEmptySubtitle]}>
            No outstanding balances
          </Text>
        </View>
      )}

      {/* Payment Confirmation Modal - Available for manual payments (offline scenarios) */}
      {(
        <Modal
          visible={showPaymentModal}
          transparent={true}
          animationType="fade"
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, isDarkMode && styles.darkModalContainer]}>
              <Icon name="cash-check" size={48} color="#4CAF50" />
              <Text style={[styles.modalTitle, isDarkMode && styles.darkModalTitle]}>
                Confirm Payment
              </Text>
              <Text style={[styles.modalMessage, isDarkMode && styles.darkModalMessage]}>
                Mark {paymentPlayer?.name} as fully paid?{'\n'}
                Total: {formatCurrency(paymentPlayer?.total || 0, organization?.currency || 'GBP')}
              </Text>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.cancelButton, isDarkMode && styles.darkCancelButton]}
                  onPress={() => {
                    setShowPaymentModal(false);
                    setPaymentPlayer(null);
                  }}
                >
                  <Text style={[styles.cancelButtonText, isDarkMode && styles.darkCancelButtonText]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={confirmMarkAllPaid}
                >
                  <Text style={styles.confirmButtonText}>Confirm Payment</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Breakdown Modal */}
      <Modal
        visible={showBreakdownModal}
        transparent={true}
        animationType="slide"
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.breakdownModal, isDarkMode && styles.darkBreakdownModal]}>
            <View style={[styles.breakdownHeader, isDarkMode && styles.darkBreakdownHeader]}>
              <View style={styles.breakdownHeaderLeft}>
                <Text style={[styles.breakdownTitle, isDarkMode && styles.darkBreakdownTitle]}>
                  {selectedPlayer?.name}
                </Text>
                <Text style={[styles.breakdownTotal, isDarkMode && styles.darkBreakdownTotal]}>
                  Total: {formatCurrency(selectedPlayer?.total || 0, organization?.currency || 'GBP')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  setShowBreakdownModal(false);
                  setSelectedPlayer(null);
                }}
              >
                <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#333'} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.breakdownList} showsVerticalScrollIndicator={false}>
              {/* Assignments Section */}
              {selectedPlayer?.assignments && selectedPlayer.assignments.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, isDarkMode && styles.darkSectionHeader]}>Items</Text>
                  {selectedPlayer.assignments.map((assignment, index) => {
                    // Handle different property names for amount
                    const amount = assignment.total || assignment.amount || assignment.totalAmount || 0;
                    const validAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
                    
                    // Handle different property names for product
                    const productName = assignment.product || assignment.productName || 'Unknown Product';
                    const quantity = assignment.quantity || 1;
                    const date = assignment.date ? formatUKDateTime(assignment.date) : ((assignment as any).createdAt ? formatUKDateTime((assignment as any).createdAt) : 'No Date');
                    const isPaid = assignment.paid || false;
                    
                    return (
                      <View key={assignment.id || `assignment-${index}`} style={[styles.breakdownItem, isDarkMode && styles.darkBreakdownItem]}>
                        <View style={styles.breakdownInfo}>
                          <Text style={[styles.breakdownProduct, isDarkMode && styles.darkBreakdownProduct]}>
                            {quantity}x {productName}
                          </Text>
                          <Text style={[styles.breakdownDate, isDarkMode && styles.darkBreakdownDate]}>
                            {date} {isPaid ? '(Paid)' : '(Unpaid)'}
                          </Text>
                        </View>
                        <View style={styles.breakdownRight}>
                          <Text style={[styles.breakdownAmount, isDarkMode && styles.darkBreakdownAmount]}>
                            {formatCurrency(validAmount, organization?.currency || 'GBP')}
                          </Text>
                          <View style={styles.assignmentActions}>
                            {!isPaid && (
                              <TouchableOpacity
                                style={[styles.itemPaidButton, isDarkMode && styles.darkItemPaidButton]}
                                onPress={() => handleMarkIndividualPaid(assignment)}
                              >
                                <Icon name="check" size={14} color="#fff" />
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={[styles.itemDeleteButton, isDarkMode && styles.darkItemDeleteButton]}
                              onPress={() => handleDeleteAssignment(assignment)}
                            >
                              <Icon name="trash-can" size={14} color="#fff" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </>
              )}



              {/* Empty state */}
              {(!selectedPlayer?.assignments || selectedPlayer.assignments.length === 0) && (
                <View style={styles.emptyBreakdown}>
                  <Icon name="receipt-outline" size={48} color={isDarkMode ? '#666' : '#ccc'} />
                  <Text style={[styles.emptyBreakdownText, isDarkMode && styles.darkEmptyBreakdownText]}>
                    No assignments found for this player
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.breakdownFooter}>
              <TouchableOpacity
                style={[styles.payAllButton, isDarkMode && styles.darkPayAllButton]}
                onPress={() => {
                  setShowBreakdownModal(false);
                  if (selectedPlayer) {
                    handleMarkAllPaid(selectedPlayer);
                  }
                }}
              >
                <Icon name="check-all" size={18} color="#fff" />
                <Text style={styles.payAllButtonText}>
                  Pay All ({formatCurrency(selectedPlayer?.total || 0, organization?.currency || 'GBP')})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  darkContainer: {
    backgroundColor: '#121212',
  },
  
  // Header styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  darkHeader: {
    backgroundColor: '#1e1e1e',
    borderBottomColor: '#333',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 12,
    color: '#333',
  },
  darkHeaderTitle: {
    color: '#fff',
  },

  // List styles
  listContainer: {
    padding: 16,
  },
  
  // Player card styles - Compact version
  playerCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  darkPlayerCard: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#fff',
    shadowOpacity: 0.03,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  darkPlayerName: {
    color: '#fff',
  },
  playerAmount: {
    fontSize: 14,
    fontWeight: '500',
    color: '#e53e3e',
  },
  darkPlayerAmount: {
    color: '#ff6b6b',
  },
  itemCount: {
    fontSize: 14,
    color: '#666',
  },
  darkItemCount: {
    color: '#999',
  },
  
  // Action icons container and styles
  actionIcons: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  breakdownIcon: {
    backgroundColor: '#f0f8ff',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  darkBreakdownIcon: {
    backgroundColor: '#1a2332',
    borderColor: '#4A90E2',
  },
  stripeIcon: {
    backgroundColor: '#635BFF',
  },
  markPaidIcon: {
    backgroundColor: '#4CAF50',
  },
  darkMarkPaidIcon: {
    backgroundColor: '#2E7D32',
  },
  
  // Legacy button styles (kept for compatibility)
  buttonContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  breakdownButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  darkBreakdownButton: {
    backgroundColor: '#2a2a2a',
    borderColor: '#4A90E2',
  },
  breakdownButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '500',
  },
  darkBreakdownButtonText: {
    color: '#4A90E2',
  },
  markPaidButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  darkMarkPaidButton: {
    backgroundColor: '#2E7D32',
  },
  markPaidButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Empty state styles
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  darkEmptyTitle: {
    color: '#fff',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  darkEmptySubtitle: {
    color: '#999',
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    minWidth: width * 0.8,
    maxWidth: 400,
  },
  darkModalContainer: {
    backgroundColor: '#1e1e1e',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  darkModalTitle: {
    color: '#fff',
  },
  modalMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  darkModalMessage: {
    color: '#ccc',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  darkCancelButton: {
    backgroundColor: '#333',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  darkCancelButtonText: {
    color: '#ccc',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Breakdown modal styles
  breakdownModal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: width * 0.9,
    maxWidth: 500,
    height: '80%', // Changed from maxHeight to fixed height
    display: 'flex',
    flexDirection: 'column',
  },
  darkBreakdownModal: {
    backgroundColor: '#1e1e1e',
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  darkBreakdownHeader: {
    borderBottomColor: '#333',
  },
  breakdownHeaderLeft: {
    flex: 1,
  },
  breakdownTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  darkBreakdownTitle: {
    color: '#fff',
  },
  breakdownTotal: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e53e3e',
  },
  darkBreakdownTotal: {
    color: '#ff6b6b',
  },
  closeButton: {
    padding: 8,
  },
  breakdownList: {
    flex: 1,
    backgroundColor: '#f9f9f9', // Add background to see if ScrollView area is visible
    minHeight: 200, // Ensure minimum height
  },
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#ffffff', // Force visible background
    minHeight: 60, // Ensure minimum height
  },
  darkBreakdownItem: {
    borderBottomColor: '#333',
    backgroundColor: '#2a2a2a', // Force visible background for dark mode
  },
  breakdownInfo: {
    flex: 1,
  },
  breakdownProduct: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  darkBreakdownProduct: {
    color: '#fff',
  },
  breakdownDate: {
    fontSize: 14,
    color: '#666',
  },
  darkBreakdownDate: {
    color: '#999',
  },
  breakdownRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  breakdownAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e53e3e',
    minWidth: 70,
    textAlign: 'right',
  },
  darkBreakdownAmount: {
    color: '#ff6b6b',
  },
  itemPaidButton: {
    backgroundColor: '#4CAF50',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkItemPaidButton: {
    backgroundColor: '#2E7D32',
  },
  assignmentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemDeleteButton: {
    backgroundColor: '#f44336',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkItemDeleteButton: {
    backgroundColor: '#d32f2f',
  },
  breakdownFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  payAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  darkPayAllButton: {
    backgroundColor: '#2E7D32',
  },
  payAllButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Stripe payment button styles
  stripePayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#635BFF', // Stripe brand color
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    gap: 6,
    minWidth: 120,
    justifyContent: 'center',
  },
  darkStripePayButton: {
    backgroundColor: '#5A52E8',
  },
  stripePayButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },

  // Stripe indicator styles
  stripeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 4,
  },
  stripeIndicatorText: {
    color: '#635BFF',
    fontSize: 12,
    fontWeight: '500',
  },

  // Empty breakdown styles
  emptyBreakdown: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBreakdownText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  darkEmptyBreakdownText: {
    color: '#999',
  },
  debugText: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  darkDebugText: {
    color: '#666',
  },
  debugContainer: {
    padding: 8,
    backgroundColor: '#fff3cd',
    borderRadius: 4,
    margin: 4,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  darkSectionHeader: {
    color: '#fff',
  },
  chargeDescription: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 2,
  },
  darkChargeDescription: {
    color: '#999',
  },
});
