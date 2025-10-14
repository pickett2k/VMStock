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

interface Charge {
  id?: string;
  playerId: string;
  playerName: string;
  amount: number;
  reason: string;
  reasonName?: string;
  reasonDescription?: string;
  date: string;
  status: 'pending' | 'paid';
  organizationId: string;
  notes?: string;
}

interface PlayerChargeTotal {
  name: string;
  total: number;
  charges: Charge[];
  playerId?: string;
}

export default function PlayerCharges() {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [playerTotals, setPlayerTotals] = useState<PlayerChargeTotal[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerChargeTotal | null>(null);
  const [showBreakdownModal, setShowBreakdownModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentPlayer, setPaymentPlayer] = useState<PlayerChargeTotal | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const { isDarkMode } = useTheme();
  const { isAdmin, assignedPlayer } = useAuth();
  const { organization } = useOrganization();

  const loadCharges = async () => {
    try {
      const [charges, playersData] = await Promise.all([
        hybridSyncService.getChargesWithOverlay(), // Use overlay to show provisional charges
        hybridSyncService.getPlayersWithOverlay() // Use overlay to show provisional balance changes
      ]);
      
      console.log('💳 PlayerCharges loaded with overlays:', {
        charges: charges.length,
        players: playersData.length
      });
      
      setPlayers(playersData);
      
      // Filter out charges with invalid data and only get unpaid ones
      const validCharges = charges.filter((c: any) => {
        const playerName = c.playerName;
        const isValid = playerName && playerName !== 'Unknown Player' && playerName.trim() !== '';
        const isUnpaid = c.status !== 'paid';
        const hasValidAmount = c.amount !== undefined && c.amount !== null && c.amount > 0;
        
        return isValid && isUnpaid && hasValidAmount;
      });
      
      console.log('💳 Valid unpaid charges:', validCharges.length);
      setCharges(validCharges);
    } catch (error) {
      console.error('Error loading charges:', error);
      Alert.alert('Error', 'Failed to load charges. Please try again.');
    }
  };

  const calculatePlayerTotals = useCallback(() => {
    // Group charges by player
    const groupedByPlayer = charges.reduce((acc: Record<string, Charge[]>, charge) => {
      const playerName = charge.playerName || 'Unknown Player';
      if (!acc[playerName]) {
        acc[playerName] = [];
      }
      acc[playerName].push(charge);
      return acc;
    }, {});

    // Calculate totals for each player
    let playerTotalsArray = Object.entries(groupedByPlayer).map(([playerName, playerCharges]) => {
      const total = playerCharges.reduce((sum, charge) => {
        const amount = charge.amount || 0;
        const validAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
        return sum + validAmount;
      }, 0);

      // Find corresponding player data for balance updates
      const playerData = players.find(p => {
        const pName = p.name || `${p.firstName} ${p.lastName}`;
        return pName === playerName;
      });

      return {
        name: playerName,
        total: Math.round(total * 100) / 100, // Round to 2 decimal places
        charges: playerCharges,
        playerId: playerData?.id
      };
    }).filter(player => player.total > 0); // Only include players with positive totals

    // Sort by total amount (highest first)  
    playerTotalsArray.sort((a, b) => b.total - a.total);

    // Filter based on user role
    if (!isAdmin && assignedPlayer) {
      const assignedPlayerName = assignedPlayer.name || `${assignedPlayer.firstName} ${assignedPlayer.lastName}`;
      playerTotalsArray = playerTotalsArray.filter(player => player.name === assignedPlayerName);
      console.log('👤 PlayerCharges: Filtered for regular user, showing charges for:', assignedPlayerName);
    } else if (isAdmin) {
      console.log('👑 PlayerCharges: Admin view, showing all player charges');
    } else {
      // User not assigned to any player, show empty list
      playerTotalsArray = [];
      console.log('🚫 PlayerCharges: User not assigned to any player, showing no charges');
    }

    console.log('📊 PlayerCharges: Final player totals:', playerTotalsArray.length);
    console.log('📊 PlayerCharges: Data details:', playerTotalsArray.map(p => ({ name: p.name, total: p.total, charges: p.charges.length })));
    setPlayerTotals(playerTotalsArray);
  }, [charges, players, isAdmin, assignedPlayer]);

  const handleMarkAllPaid = (player: PlayerChargeTotal) => {
    if (STRIPE_ENABLED && Platform.OS === 'android' && organization?.settings?.features?.enableStripePayments) {
      // Use Stripe payment processing
      handleStripePayment(player);
    } else {
      // Use legacy manual payment confirmation
      setPaymentPlayer(player);
      setShowPaymentModal(true);
    }
  };

  const handleManualMarkPaid = (player: PlayerChargeTotal) => {
    // Show confirmation to prevent accidental marking as paid
    Alert.alert(
      'Mark as Paid',
      `Are you sure you want to mark all charges for ${player.name} as paid?\\n\\nAmount: ${formatCurrency(player.total, organization?.currency || 'GBP')}\\nCharges: ${player.charges.length}`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Confirm',
          style: 'default',
          onPress: () => {
            setPaymentPlayer(player);
            setShowPaymentModal(true);
          },
        },
      ]
    );
  };

  const handleStripePayment = async (player: PlayerChargeTotal) => {
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
        description: `VMStock charges payment for ${player.name}`,
        metadata: {
          playerName: player.name,
          chargeCount: player.charges.length.toString(),
          source: 'player_charges'
        }
      };

      console.log(`💳 Processing Stripe payment for ${player.name} charges: ${formatCurrency(player.total, organization?.currency || 'GBP')}`);

      // Process payment using Stripe (uses manual entry with test card)
      const result: StripePaymentResult = await stripePaymentService.processManualEntry(paymentRequest);

      if (result.success) {
        // Mark all charges as paid for this player
        for (const charge of player.charges) {
          if (charge.id) {
            await hybridSyncService.updateChargeStatus(charge.id, 'paid');
          }
        }

        Alert.alert(
          'Payment Successful',
          `Payment of ${formatCurrency(player.total, organization?.currency || 'GBP')} completed successfully for ${player.name} charges.`,
          [{ 
            text: 'OK',
            onPress: () => {
              // Refresh data to show updated state
              loadCharges();
            }
          }]
        );
      } else {
        Alert.alert('Payment Failed', result.error || 'Payment could not be processed');
      }
    } catch (error) {
      console.error('❌ Stripe payment error:', error);
      Alert.alert('Payment Error', 'Failed to process payment. Please try again.');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleConfirmPayment = async () => {
    if (!paymentPlayer) return;

    try {
      // Mark all charges as paid for this player
      for (const charge of paymentPlayer.charges) {
        if (charge.id) {
          await hybridSyncService.updateChargeStatus(charge.id, 'paid');
        }
      }

      Alert.alert(
        'Payment Recorded',
        `Manual payment of ${formatCurrency(paymentPlayer.total, organization?.currency || 'GBP')} recorded for ${paymentPlayer.name} charges.`,
        [{ 
          text: 'OK',
          onPress: () => {
            // Refresh data to show updated state
            loadCharges();
          }
        }]
      );
    } catch (error) {
      console.error('Error processing charges payment:', error);
      Alert.alert('Error', 'Failed to record payment. Please try again.');
    }

    setShowPaymentModal(false);
    setPaymentPlayer(null);
  };

  const handleViewBreakdown = (player: PlayerChargeTotal) => {
    setSelectedPlayer(player);
    setShowBreakdownModal(true);
    setExpandedDescriptions(new Set()); // Reset expanded descriptions when opening modal
  };

  const toggleDescriptionExpansion = (chargeId: string) => {
    setExpandedDescriptions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chargeId)) {
        newSet.delete(chargeId);
      } else {
        newSet.add(chargeId);
      }
      return newSet;
    });
  };

  const handleMarkIndividualPaid = async (charge: Charge) => {
    try {
      if (charge.id) {
        await hybridSyncService.updateChargeStatus(charge.id, 'paid');
        Alert.alert('Success', 'Charge marked as paid');
        
        // Refresh the data to show updated charges
        await loadCharges();
        
        // Update the selected player's charges for the modal
        if (selectedPlayer) {
          const updatedCharges = selectedPlayer.charges.filter(c => c.id !== charge.id);
          const updatedTotal = updatedCharges.reduce((sum, c) => {
            const amount = c.amount || 0;
            return sum + (typeof amount === 'number' && !isNaN(amount) ? amount : 0);
          }, 0);
          
          if (updatedCharges.length === 0) {
            // No more charges for this player
            setShowBreakdownModal(false);
            setSelectedPlayer(null);
          } else {
            // Update the selected player with remaining charges
            setSelectedPlayer({
              ...selectedPlayer,
              charges: updatedCharges,
              total: Math.round(updatedTotal * 100) / 100
            });
          }
        }
      }
    } catch (error) {
      console.error('Error marking charge as paid:', error);
      Alert.alert('Error', 'Failed to mark charge as paid');
    }
  };

  const handleDeleteCharge = async (charge: Charge) => {
    Alert.alert(
      'Delete Charge',
      `Are you sure you want to delete this charge?\\n\\n${charge.reasonName || charge.reasonDescription || 'Unknown Reason'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (charge.id) {
                await hybridSyncService.deleteCharge(charge.id);
                Alert.alert('Success', 'Charge deleted');
                
                // Refresh the data
                await loadCharges();
                
                // Update modal if needed
                if (selectedPlayer) {
                  const updatedCharges = selectedPlayer.charges.filter(c => c.id !== charge.id);
                  if (updatedCharges.length === 0) {
                    setShowBreakdownModal(false);
                    setSelectedPlayer(null);
                  } else {
                    const updatedTotal = updatedCharges.reduce((sum, c) => {
                      const amount = c.amount || 0;
                      return sum + (typeof amount === 'number' && !isNaN(amount) ? amount : 0);
                    }, 0);
                    setSelectedPlayer({
                      ...selectedPlayer,
                      charges: updatedCharges,
                      total: Math.round(updatedTotal * 100) / 100
                    });
                  }
                }
              }
            } catch (error) {
              console.error('Error deleting charge:', error);
              Alert.alert('Error', 'Failed to delete charge');
            }
          }
        }
      ]
    );
  };

  // Load data when component mounts or when it gains focus
  useFocusEffect(
    useCallback(() => {
      loadCharges();
    }, [])
  );

  // Recalculate totals when charges or players change
  useEffect(() => {
    calculatePlayerTotals();
  }, [calculatePlayerTotals]);

  const renderPlayerCard = ({ item }: { item: PlayerChargeTotal }) => {
    console.log('🎨 PlayerCharges: Rendering card for player:', item.name);
    return (
      <View style={[styles.playerCard, isDarkMode && styles.darkPlayerCard]}>
        <View style={styles.playerInfo}>
          <Text style={[styles.playerName, isDarkMode && styles.darkPlayerName]}>
            {item.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.playerAmount, isDarkMode && styles.darkPlayerAmount]}>
              {formatCurrency(item.total, organization?.currency || 'GBP')}
            </Text>
            <Text style={[styles.itemCount, isDarkMode && styles.darkItemCount]}>
              • {item.charges.length} charge{item.charges.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
        
        <View style={styles.actionIcons}>
          <TouchableOpacity
            style={[styles.iconButton, styles.breakdownIcon, isDarkMode && styles.darkBreakdownIcon]}
            onPress={() => {
              console.log('👁️ PlayerCharges: Eye icon pressed for player:', item.name);
              handleViewBreakdown(item);
            }}
          >
            <Icon name="eye" size={18} color="#fff" />
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
              <Icon name="check" size={18} color="#fff" />
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
    );
  };

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <View style={[styles.header, isDarkMode && styles.darkHeader]}>
        <Icon name="cash-multiple" size={28} color={isDarkMode ? '#fff' : '#333'} />
        <Text style={[styles.headerTitle, isDarkMode && styles.darkHeaderTitle]}>
          Player Charges
        </Text>
      </View>

      {playerTotals.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="cash-remove" size={64} color={isDarkMode ? '#666' : '#ccc'} />
          <Text style={[styles.emptyText, isDarkMode && styles.darkEmptyText]}>
            No outstanding charges
          </Text>
          <Text style={[styles.emptySubtext, isDarkMode && styles.darkEmptySubtext]}>
            All charges have been paid
          </Text>
        </View>
      ) : (
        <FlatList
          data={playerTotals}
          renderItem={renderPlayerCard}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Payment Confirmation Modal - Available for manual payments (offline scenarios) */}
      {paymentPlayer && (
        <Modal
          visible={showPaymentModal}
          transparent={true}
          animationType="fade"
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, isDarkMode && styles.darkModalContainer]}>
              <Icon name="cash" size={48} color={isDarkMode ? '#4CAF50' : '#4CAF50'} />
              <Text style={[styles.modalTitle, isDarkMode && styles.darkModalTitle]}>
                Confirm Payment
              </Text>
              <Text style={[styles.modalMessage, isDarkMode && styles.darkModalMessage]}>
                Mark all charges for {paymentPlayer.name} as paid for {formatCurrency(paymentPlayer.total, organization?.currency || 'GBP')}?
              </Text>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.cancelButton, isDarkMode && styles.darkCancelButton]}
                  onPress={() => {
                    setShowPaymentModal(false);
                    setPaymentPlayer(null);
                  }}
                >
                  <Text style={[styles.cancelButtonText, isDarkMode && styles.darkCancelButtonText]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={handleConfirmPayment}
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
              {/* Charges Section */}
              {selectedPlayer?.charges && selectedPlayer.charges.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, isDarkMode && styles.darkSectionHeader]}>Charges</Text>
                  {selectedPlayer.charges.map((charge, index) => {
                    // Get reason name from organization charge reasons or use reasonDescription as fallback
                    const chargeReasons = organization?.settings?.chargeReasons || [];
                    const matchingReason = chargeReasons.find(reason => reason.id === charge.reason);
                    const reasonLabel = charge.reasonName || matchingReason?.name || charge.reasonDescription || 'Other';
                    const date = charge.date ? formatUKDateTime(charge.date) : 'No Date';
                    const isPaid = charge.status === 'paid';
                    
                    return (
                      <View key={charge.id || `charge-${index}`} style={[styles.breakdownItem, isDarkMode && styles.darkBreakdownItem]}>
                        <View style={styles.breakdownInfo}>
                          <Text style={[styles.breakdownProduct, isDarkMode && styles.darkBreakdownProduct]}>
                            {reasonLabel}
                          </Text>
                          <Text style={[styles.breakdownDate, isDarkMode && styles.darkBreakdownDate]}>
                            {date} {isPaid ? '(Paid)' : '(Unpaid)'}
                          </Text>
                          {charge.notes && (
                            <View>
                              <Text 
                                style={[styles.chargeDescription, isDarkMode && styles.darkChargeDescription]} 
                                numberOfLines={expandedDescriptions.has(charge.id || `charge-${index}`) ? undefined : 3}
                              >
                                {charge.notes}
                              </Text>
                              {charge.notes.length > 100 && (
                                <TouchableOpacity 
                                  onPress={() => toggleDescriptionExpansion(charge.id || `charge-${index}`)}
                                  style={styles.expandButton}
                                >
                                  <Text style={[styles.expandButtonText, isDarkMode && styles.darkExpandButtonText]}>
                                    {expandedDescriptions.has(charge.id || `charge-${index}`) ? 'Show less' : 'Show more'}
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          )}
                        </View>
                        <View style={styles.breakdownRight}>
                          <Text style={[styles.breakdownAmount, isDarkMode && styles.darkBreakdownAmount]}>
                            {formatCurrency(charge.amount, organization?.currency || 'GBP')}
                          </Text>
                          <View style={styles.chargeActions}>
                            {/* Admin-only charge management buttons */}
                            {isAdmin && (
                              <>
                                {!isPaid && (
                                  <TouchableOpacity
                                    style={[styles.chargePaidButton, isDarkMode && styles.darkChargePaidButton]}
                                    onPress={() => handleMarkIndividualPaid(charge)}
                                  >
                                    <Icon name="check" size={14} color="#fff" />
                                  </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                  style={[styles.chargeDeleteButton, isDarkMode && styles.darkChargeDeleteButton]}
                                  onPress={() => handleDeleteCharge(charge)}
                                >
                                  <Icon name="trash-can" size={14} color="#fff" />
                                </TouchableOpacity>
                              </>
                            )}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </>
              )}

              {/* Empty state */}
              {(!selectedPlayer?.charges || selectedPlayer.charges.length === 0) && (
                <View style={styles.emptyBreakdown}>
                  <Icon name="cash-remove" size={48} color={isDarkMode ? '#666' : '#ccc'} />
                  <Text style={[styles.emptyBreakdownText, isDarkMode && styles.darkEmptyBreakdownText]}>
                    No charges found for this player
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
                  Pay All Charges ({formatCurrency(selectedPlayer?.total || 0, organization?.currency || 'GBP')})
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
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakdownIcon: {
    backgroundColor: '#007AFF',
  },
  darkBreakdownIcon: {
    backgroundColor: '#0A84FF',
  },
  stripeIcon: {
    backgroundColor: '#6772E5', // Stripe brand color
  },
  markPaidIcon: {
    backgroundColor: '#4CAF50',
  },
  darkMarkPaidIcon: {
    backgroundColor: '#2E7D32',
  },
  disabledButton: {
    opacity: 0.5,
  },

  // Empty state styles
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    textAlign: 'center',
  },
  darkEmptyText: {
    color: '#999',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
  darkEmptySubtext: {
    color: '#666',
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
    height: '80%',
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
    backgroundColor: '#f9f9f9',
    minHeight: 200,
  },
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#ffffff',
    minHeight: 60,
  },
  darkBreakdownItem: {
    borderBottomColor: '#333',
    backgroundColor: '#2a2a2a',
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
  chargePaidButton: {
    backgroundColor: '#4CAF50',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkChargePaidButton: {
    backgroundColor: '#2E7D32',
  },
  chargeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chargeDeleteButton: {
    backgroundColor: '#f44336',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkChargeDeleteButton: {
    backgroundColor: '#d32f2f',
  },
  breakdownFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  darkBreakdownFooter: {
    borderTopColor: '#333',
  },
  payAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    paddingHorizontal: 20,
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

  // Section headers
  sectionHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f0f0f0',
  },
  darkSectionHeader: {
    color: '#fff',
    backgroundColor: '#333',
  },

  // Empty breakdown state
  emptyBreakdown: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyBreakdownText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    textAlign: 'center',
  },
  darkEmptyBreakdownText: {
    color: '#999',
  },

  // Charge description style
  chargeDescription: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
    fontStyle: 'italic',
    flex: 1,
    flexWrap: 'wrap',
    lineHeight: 16,
  },
  darkChargeDescription: {
    color: '#aaa',
  },

  // Expand button styles
  expandButton: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  expandButtonText: {
    fontSize: 11,
    color: '#007AFF',
    fontWeight: '500',
  },
  darkExpandButtonText: {
    color: '#4A9EFF',
  },
});