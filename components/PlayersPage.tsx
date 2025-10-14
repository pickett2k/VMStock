import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  Modal,
  StyleSheet,
  Platform,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback
} from 'react-native';
import { FirebaseService, Player } from '../services/FirebaseService';
import { hybridSyncService } from '../services/HybridSyncService';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../app/ThemeContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { MaterialIcons } from '@expo/vector-icons';
import { formatCurrency } from '../utils/currency';
import { Dropdown } from 'react-native-element-dropdown';

// Define modal styles first
const getModalStyles = (isDarkMode: boolean) => StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#fff',
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? '#444' : '#e0e0e0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#333',
  },
  cancelButton: {
    color: '#2196F3',
    fontSize: 16,
  },
  form: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  halfInput: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: isDarkMode ? '#333' : '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: isDarkMode ? '#555' : '#e0e0e0',
    marginBottom: 16,
    color: isDarkMode ? '#fff' : '#333',
  },
  helpText: {
    fontSize: 14,
    color: isDarkMode ? '#ccc' : '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  disabledButton: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
});

// Separate PlayerModal component to prevent re-renders
const PlayerModal = React.memo(({ 
  visible, 
  onClose, 
  title, 
  formData, 
  onFirstNameChange, 
  onLastNameChange, 
  onSave,
  isEditMode,
  isDarkMode,
  isSubmitting = false
}: { 
  visible: boolean; 
  onClose: () => void; 
  title: string;
  formData: { firstName: string; lastName: string };
  onFirstNameChange: (text: string) => void;
  onLastNameChange: (text: string) => void;
  onSave: () => void;
  isEditMode: boolean;
  isDarkMode: boolean;
  isSubmitting?: boolean;
}) => {
  const modalStyles = getModalStyles(isDarkMode);
  
  return (
  <Modal
    visible={visible}
    animationType="slide"
    presentationStyle="pageSheet"
  >
    <View style={modalStyles.modalContainer}>
      <View style={modalStyles.modalHeader}>
        <Text style={modalStyles.modalTitle}>{title}</Text>
        <TouchableOpacity 
          onPress={onClose}
          disabled={isSubmitting}
          style={isSubmitting && { opacity: 0.5 }}
        >
          <Text style={modalStyles.cancelButton}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <View style={modalStyles.form}>
        <View style={modalStyles.row}>
          <View style={modalStyles.halfInput}>
            <Text style={modalStyles.label}>First Name *</Text>
            <TextInput
              style={modalStyles.input}
              value={formData.firstName}
              onChangeText={onFirstNameChange}
              placeholder="First Name"
              placeholderTextColor={isDarkMode ? '#999' : '#666'}
              autoFocus={true}
              returnKeyType="next"
              onSubmitEditing={Keyboard.dismiss}
            />
          </View>
          <View style={modalStyles.halfInput}>
            <Text style={modalStyles.label}>Last Name *</Text>
            <TextInput
              style={modalStyles.input}
              value={formData.lastName}
              onChangeText={onLastNameChange}
              placeholder="Last Name"
              placeholderTextColor={isDarkMode ? '#999' : '#666'}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
          </View>
        </View>

        <Text style={modalStyles.helpText}>
          You can assign this player to an existing user account after creating them.
        </Text>

        <TouchableOpacity
          style={[
            modalStyles.saveButton,
            isSubmitting && modalStyles.disabledButton
          ]}
          onPress={onSave}
          disabled={isSubmitting}
        >
          <Text style={modalStyles.saveButtonText}>
            {isSubmitting 
              ? (isEditMode ? 'Updating...' : 'Adding...') 
              : (isEditMode ? 'Update Player' : 'Add Player')
            }
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
  );
});

interface PlayersPageProps {
  organizationId?: string;
}

export const PlayersPage: React.FC<PlayersPageProps> = ({ 
  organizationId 
}) => {
  const { isAdmin } = useAuth();
  const { isDarkMode } = useTheme();
  const { organization } = useOrganization();
  const currentOrgId = organizationId || organization?.id;
  const [players, setPlayers] = useState<Player[]>([]);
  const [filteredPlayers, setFilteredPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [assignmentEmail, setAssignmentEmail] = useState('');
  const [organizationUsers, setOrganizationUsers] = useState<Array<{uid: string, email: string, displayName: string}>>([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  
  // Charge modal state
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [selectedChargeReason, setSelectedChargeReason] = useState<any>(null);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDescription, setChargeDescription] = useState('');
  
  // Submission state tracking to prevent duplicates during poor signal
  const [isSubmittingPlayer, setIsSubmittingPlayer] = useState(false);
  const [isSubmittingCharge, setIsSubmittingCharge] = useState(false);
  
  // Form state - simplified
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: ''
  });

  // Memoized form handlers to prevent re-renders
  const handleFirstNameChange = useCallback((text: string) => {
    setFormData(prev => ({ ...prev, firstName: text }));
  }, []);

  const handleLastNameChange = useCallback((text: string) => {
    setFormData(prev => ({ ...prev, lastName: text }));
  }, []);

  const firebaseService = new FirebaseService(currentOrgId!);

  useFocusEffect(
    useCallback(() => {
      loadPlayers();
      loadOrganizationUsers();
    }, [])
  );

  const loadOrganizationUsers = async () => {
    try {
      const staffUsers = await firebaseService.getStaffUsers();
      const users = staffUsers.map(staff => ({
        uid: staff.uid,
        email: staff.email,
        displayName: staff.displayName
      }));
      setOrganizationUsers(users);
    } catch (error) {
      console.error('Error loading organization users:', error);
    }
  };

  // Helper function to get display name from email
  const getDisplayNameForUser = (email: string): string => {
    const user = organizationUsers.find(user => user.email === email);
    return user?.displayName || email;
  };

  const updateNetworkStatus = async () => {
    try {
      const networkState = await hybridSyncService.refreshNetworkState();
      setIsOnline(networkState);
    } catch (error) {
      console.error('Error updating network status:', error);
    }
  };



  useEffect(() => {
    filterPlayers();
  }, [searchQuery, players]);

  useEffect(() => {
    updateNetworkStatus();

    const interval = setInterval(updateNetworkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadPlayers = async (showLoadingState = true) => {
    try {
      // Only show loading state for initial load, not refreshes
      if (showLoadingState && players.length === 0) {
        setLoading(true);
      }
      console.log('📱 PlayersPage: Loading players via HybridSyncService');
      
      // Check network status
      const isOnline = await hybridSyncService.refreshNetworkState();
      console.log('📱 PlayersPage: Network status:', isOnline ? 'Online' : 'Offline');
      
      const playersData = await hybridSyncService.getPlayersWithOverlay(); // Use overlay to show provisional balance changes
      console.log('📱 PlayersPage: Loaded players:', {
        count: playersData.length,
        isOnline,
        players: playersData.map(p => ({ id: p.id, name: p.name, firstName: p.firstName, lastName: p.lastName }))
      });
      
      setPlayers(playersData);
      
      // If no players loaded and offline, alert user
      if (playersData.length === 0 && !isOnline) {
        console.warn('⚠️ PlayersPage: No players loaded while offline - cache may be empty');
      }
    } catch (error) {
      console.error('❌ PlayersPage: Error loading players:', error);
      Alert.alert('Error', 'Failed to load players: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  };

  const filterPlayers = () => {
    if (!searchQuery) {
      setFilteredPlayers(players);
      return;
    }

    const filtered = players.filter(player =>
      `${player.firstName} ${player.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (player.email && player.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (player.studentId && player.studentId.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (player.grade && player.grade.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    setFilteredPlayers(filtered);
  };

  const resetForm = () => {
    setFormData({
      firstName: '',
      lastName: ''
    });
  };

  const handleAddPlayer = () => {
    resetForm();
    setShowAddModal(true);
  };

  const handleEditPlayer = (player: Player) => {
    setSelectedPlayer(player);
    setFormData({
      firstName: player.firstName ?? '',
      lastName: player.lastName ?? ''
    });
    setShowEditModal(true);
  };

  const handleSavePlayer = async () => {
    // Prevent multiple submissions during poor signal
    if (isSubmittingPlayer) {
      console.log('PlayersPage: Player submission already in progress, ignoring duplicate click');
      return;
    }

    // Ensure organization is loaded before proceeding
    if (!organization?.id) {
      Alert.alert('Error', 'Organization not loaded. Please wait and try again.');
      return;
    }

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      Alert.alert('Error', 'First name and last name are required');
      return;
    }

    // Set submission state immediately to prevent duplicates
    setIsSubmittingPlayer(true);

    try {
      const proposedName = `${formData.firstName.trim()} ${formData.lastName.trim()}`;
      
      // Check for duplicate names when adding new player
      if (!showEditModal) {
        const existingPlayer = players.find(p => 
          p.name?.toLowerCase() === proposedName.toLowerCase() && 
          p.isActive
        );
        
        if (existingPlayer) {
          Alert.alert(
            'Duplicate Name Warning',
            `A player named "${proposedName}" already exists. The new player will be saved as "${proposedName} (2)" to avoid confusion.\n\nDo you want to continue?`,
            [
              { 
                text: 'Cancel', 
                style: 'cancel',
                onPress: () => setIsSubmittingPlayer(false) // Reset on cancel
              },
              { 
                text: 'Continue', 
                onPress: () => proceedWithSave(proposedName)
              }
            ]
          );
          return;
        }
      }
      
      await proceedWithSave(proposedName);
    } catch (error) {
      console.error('Error saving player:', error);
      Alert.alert('Error', 'Failed to save player');
      setIsSubmittingPlayer(false); // Reset on error
    }
  };

  const proceedWithSave = async (proposedName: string) => {
    try {
      const playerData = {
        ...formData,
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        name: proposedName, // Firebase service will handle uniqueness
        balance: 0, // Start with no debt
        isActive: true,
        totalPurchases: 0,
        totalSpent: 0,
        organizationId
      };

      if (showEditModal && selectedPlayer) {
        console.log('PlayersPage: Updating player via HybridSyncService');
        await hybridSyncService.updatePlayer(selectedPlayer.id!, playerData);
        Alert.alert('Success', 'Player updated successfully');
      } else {
        console.log('PlayersPage: Adding new player via HybridSyncService (offline-first)');
        
        // Offline-first: Add player optimistically to UI immediately
        const tempPlayer: Player = {
          ...playerData,
          id: `temp_${Date.now()}`, // Temporary ID for UI
          organizationId: organizationId || organization?.id || 'unknown' // Ensure organizationId is defined
        };
        
        // Update UI immediately for better UX during poor signal
        setPlayers(prev => [...prev, tempPlayer]);
        setFilteredPlayers(prev => [...prev, tempPlayer]);
        
        // Queue the actual save operation
        await hybridSyncService.addPlayer(playerData);
        Alert.alert('Success', 'Player added successfully');
      }

      // Close modals and reset form
      setShowAddModal(false);
      setShowEditModal(false);
      setSelectedPlayer(null);
      resetForm();
      
      // Reload players to get the final state from sync
      await loadPlayers();
    } catch (error) {
      console.error('Error saving player:', error);
      Alert.alert('Error', 'Failed to save player');
    } finally {
      // Always reset submission state
      setIsSubmittingPlayer(false);
    }
  };

  const handleUpdateBalance = (player: Player) => {
    setSelectedPlayer(player);
    setShowChargeModal(true);
  };

  // Legacy function - kept for compatibility, but new charges should use handleSubmitCharge
  const updatePlayerBalance = async (player: Player, amount: number, isDebit: boolean, reason?: string, reasonLabel?: string) => {
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    try {
      console.log('PlayersPage: Creating charge bundle:', {
        playerId: player.id,
        playerName: player.name,
        amount: isDebit ? amount : -amount, // Positive for charges, negative for payments
        isDebit
      });
      
      await hybridSyncService.createChargeBundle({
        playerId: player.id!,
        playerName: player.name || `${player.firstName} ${player.lastName}`,
        amount: isDebit ? amount : -amount, // Positive for charges, negative for payments
        reason: (reason as any) || (isDebit ? 'other' : 'payment'),
        reasonName: reasonLabel || (isDebit ? 'Manual charge' : 'Manual payment'),
        reasonDescription: reasonLabel || (isDebit ? 'Manual charge' : 'Manual payment'),
        organizationId: organization?.id || 'unknown',
        notes: `${reasonLabel || (isDebit ? 'Charge' : 'Payment')} added via PlayersPage`
      });
      
      Alert.alert('Success', `${isDebit ? 'Charge added' : 'Payment recorded'} successfully`);
      await loadPlayers();
    } catch (error) {
      console.error('Error updating balance:', error);
      Alert.alert('Error', 'Failed to update balance');
    }
  };

  // Get charge reasons from organization settings
  const getChargeReasons = () => {
    return organization?.settings?.chargeReasons?.filter(reason => reason.isActive) || [];
  };

  // Handle charge submission from modal
  const handleSubmitCharge = async () => {
    // Prevent multiple submissions during poor signal
    if (isSubmittingCharge) {
      console.log('PlayersPage: Charge submission already in progress, ignoring duplicate click');
      return;
    }

    if (!selectedPlayer || !selectedChargeReason) {
      Alert.alert('Error', 'Please select a charge reason');
      return;
    }

    const amount = parseFloat(chargeAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    // Set submission state immediately to prevent duplicates
    setIsSubmittingCharge(true);

    try {
      console.log('PlayersPage: Creating charge bundle:', {
        playerId: selectedPlayer.id,
        playerName: selectedPlayer.name,
        amount,
        reason: selectedChargeReason.id,
        reasonName: selectedChargeReason.name
      });
      
      await hybridSyncService.createChargeBundle({
        playerId: selectedPlayer.id!,
        playerName: selectedPlayer.name || `${selectedPlayer.firstName} ${selectedPlayer.lastName}`,
        amount,
        reason: 'other', // Using 'other' as default, will update service later for dynamic reasons
        reasonName: selectedChargeReason.name,
        reasonDescription: selectedChargeReason.name,
        organizationId: organization?.id || 'unknown',
        notes: chargeDescription.trim() || `${selectedChargeReason.name} added via PlayersPage`
      });
      
      Alert.alert('Success', `${selectedChargeReason.name} charge added successfully`);
      
      // Reset form
      setChargeAmount('');
      setChargeDescription('');
      setSelectedChargeReason(null);
      setShowChargeModal(false);
      setSelectedPlayer(null);
      
      await loadPlayers();
    } catch (error) {
      console.error('Error adding charge:', error);
      Alert.alert('Error', 'Failed to add charge');
    } finally {
      // Always reset submission state
      setIsSubmittingCharge(false);
    }
  };

  const handleAssignUser = (player: Player) => {
    setSelectedPlayer(player);
    setAssignmentEmail(player.assignedUserEmail || '');
    setShowUserDropdown(false);
    setShowAssignModal(true);
  };

  const handleSaveAssignment = async () => {
    if (!selectedPlayer) return;

    if (!assignmentEmail.trim()) {
      // Remove assignment
      try {
        console.log('PlayersPage: Removing assignment via HybridSyncService');
        await hybridSyncService.updatePlayer(selectedPlayer.id!, {
          assignedUserId: undefined,
          assignedUserEmail: undefined
        });
        Alert.alert('Success', 'User assignment removed successfully');
        setShowAssignModal(false);
        setSelectedPlayer(null);
        setAssignmentEmail('');
        await loadPlayers();
      } catch (error) {
        console.error('Error removing assignment:', error);
        Alert.alert('Error', 'Failed to remove user assignment');
      }
      return;
    }

    try {
      // Ensure organization is loaded before proceeding
      if (!organization?.id) {
        Alert.alert('Error', 'Organization not loaded. Please wait and try again.');
        return;
      }

      // Find the staff user by email to get their actual UID
      const staffUsers = await firebaseService.getStaffUsers();
      const assignedStaffUser = staffUsers.find(staff => staff.email === assignmentEmail.trim());
      
      if (!assignedStaffUser) {
        Alert.alert('Error', 'No staff user found with this email address');
        return;
      }

      console.log('PlayersPage: Assigning player to staff user:', {
        playerId: selectedPlayer.id,
        staffUserUID: assignedStaffUser.uid,
        staffUserEmail: assignedStaffUser.email
      });

      await hybridSyncService.updatePlayer(selectedPlayer.id!, {
        assignedUserId: assignedStaffUser.uid, // Use actual Firebase UID
        assignedUserEmail: assignedStaffUser.email
      });

      Alert.alert(
        'Success', 
        `Player assigned to ${assignedStaffUser.displayName || assignedStaffUser.email} successfully.\n\nThis user can now buy products and view bills for this player.`
      );
      setShowAssignModal(false);
      setSelectedPlayer(null);
      setAssignmentEmail('');
      await loadPlayers();
    } catch (error) {
      console.error('Error assigning user:', error);
      Alert.alert('Error', 'Failed to assign user to player');
    }
  };

  const handleDeletePlayer = (player: Player) => {
    Alert.alert(
      'Delete Player',
      `Are you sure you want to delete ${player.firstName} ${player.lastName}? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              console.log('PlayersPage: Deleting player via HybridSyncService');
              await hybridSyncService.deletePlayer(player.id!);
              
              // Refresh the players list
              await loadPlayers();
              Alert.alert('Success', 'Player deleted successfully');
            } catch (error) {
              console.error('Error deleting player:', error);
              Alert.alert('Error', 'Failed to delete player. Please try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const renderPlayer = ({ item }: { item: Player }) => (
    <View style={[styles.playerItem, isDarkMode && styles.darkPlayerItem]}>
      <View style={styles.playerInfo}>
        <Text style={[styles.playerName, isDarkMode && styles.darkPlayerName]}>
          {item.firstName} {item.lastName}
        </Text>
        <Text style={[styles.playerDetails, isDarkMode && styles.darkPlayerDetails]}>
          {item.grade && `Grade: ${item.grade}`}
          {item.studentId && ` • ID: ${item.studentId}`}
        </Text>
        <Text style={[
          styles.playerBalance,
          { color: item.balance <= 0 ? '#4CAF50' : '#F44336' }
        ]}>
          {item.balance <= 0 ? 'Paid Up' : `Owes: ${formatCurrency(item.balance, organization?.currency || 'GBP')}`}
        </Text>
        <Text style={[styles.playerStats, isDarkMode && styles.darkPlayerStats]}>
          Purchases: {item.totalPurchases} • Spent: {formatCurrency(item.totalSpent, organization?.currency || 'GBP')}
        </Text>
        {item.assignedUserEmail && (
          <Text style={styles.assignedUser}>
            👤 Assigned to: {getDisplayNameForUser(item.assignedUserEmail)}
          </Text>
        )}
      </View>
      <View style={styles.playerActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleEditPlayer(item)}
        >
          <Text style={styles.actionButtonText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.balanceButton]}
          onPress={() => handleUpdateBalance(item)}
        >
          <Text style={styles.actionButtonText}>Charge</Text>
        </TouchableOpacity>
        {isAdmin && (
          <>
            <TouchableOpacity
              style={[styles.actionButton, styles.assignButton]}
              onPress={() => handleAssignUser(item)}
            >
              <Text style={styles.actionButtonText}>
                {item.assignedUserEmail ? 'Change' : 'Assign'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.deleteButton]}
              onPress={() => handleDeletePlayer(item)}
            >
              <Text style={[styles.actionButtonText, styles.deleteButtonText]}>Delete</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );



  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View>
          <View style={[styles.header, isDarkMode && styles.darkHeader]}>
            <View style={styles.headerLeft}>
              <Text style={[styles.headerTitle, isDarkMode && styles.darkHeaderTitle]}>Players</Text>
              <Text style={[styles.headerSubtitle, isDarkMode && styles.darkHeaderSubtitle]}>
                Manage player accounts and balances
              </Text>
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleAddPlayer}
              >
                <Text style={styles.addButtonText}>+ Add Player</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TextInput
            style={[styles.searchInput, isDarkMode && styles.darkSearchInput]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search players..."
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>
      </TouchableWithoutFeedback>

      {/* Players List - Free from TouchableWithoutFeedback for proper iOS scrolling */}
      <FlatList
        data={filteredPlayers}
        keyExtractor={(item) => item.id!}
        renderItem={renderPlayer}
        style={styles.playerList}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      <PlayerModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Player"
        formData={formData}
        onFirstNameChange={handleFirstNameChange}
        onLastNameChange={handleLastNameChange}
        onSave={handleSavePlayer}
        isEditMode={false}
        isDarkMode={isDarkMode}
        isSubmitting={isSubmittingPlayer}
      />

      <PlayerModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Player"
        formData={formData}
        onFirstNameChange={handleFirstNameChange}
        onLastNameChange={handleLastNameChange}
        onSave={handleSavePlayer}
        isEditMode={true}
        isDarkMode={isDarkMode}
        isSubmitting={isSubmittingPlayer}
      />

      <Modal
        visible={showAssignModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Assign User to {selectedPlayer?.firstName} {selectedPlayer?.lastName}
            </Text>
            <TouchableOpacity onPress={() => setShowAssignModal(false)}>
              <Text style={styles.cancelButton}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Select User</Text>
            
            <TouchableOpacity
              style={styles.dropdownButton}
              onPress={() => setShowUserDropdown(!showUserDropdown)}
            >
              <Text style={styles.dropdownButtonText}>
                {assignmentEmail ? getDisplayNameForUser(assignmentEmail) : 'Choose a user or leave unassigned'}
              </Text>
              <Text style={styles.dropdownArrow}>▼</Text>
            </TouchableOpacity>

            {showUserDropdown && (
              <View style={styles.dropdownList}>
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    setAssignmentEmail('');
                    setShowUserDropdown(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>No user assigned</Text>
                </TouchableOpacity>
                
                {organizationUsers.map((user) => (
                  <TouchableOpacity
                    key={user.uid}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setAssignmentEmail(user.email);
                      setShowUserDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{user.displayName} ({user.email})</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            
            <Text style={styles.helpText}>
              Select a user who will have access to this player's account, or leave unassigned.
            </Text>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSaveAssignment}
            >
              <Text style={styles.saveButtonText}>
                {assignmentEmail.trim() ? 'Assign User' : 'Remove Assignment'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Charge Modal */}
      <Modal
        visible={showChargeModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowChargeModal(false);
          setSelectedPlayer(null);
          setSelectedChargeReason(null);
          setChargeAmount('');
          setChargeDescription('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.chargeModal}>
            <View style={styles.chargeModalHeader}>
              <Text style={styles.chargeModalTitle}>
                Add Charge - {selectedPlayer?.firstName} {selectedPlayer?.lastName}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowChargeModal(false);
                  setSelectedPlayer(null);
                  setSelectedChargeReason(null);
                  setChargeAmount('');
                  setChargeDescription('');
                }}
                style={styles.closeButton}
              >
                <MaterialIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.chargeModalContent}>
              {/* Current Balance */}
              <View style={styles.balanceInfo}>
                <Text style={styles.balanceLabel}>Current Amount Owed:</Text>
                <Text style={styles.balanceAmount}>
                  {formatCurrency(Math.abs(selectedPlayer?.balance || 0), organization?.currency || 'GBP')}
                </Text>
              </View>

              {/* Charge Reason Dropdown */}
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Charge Reason *</Text>
                {getChargeReasons().length === 0 ? (
                  <View style={styles.noReasonsContainer}>
                    <Text style={styles.noReasonsText}>
                      No charge reasons available. Please add charge reasons in Organization Settings first.
                    </Text>
                  </View>
                ) : (
                  <Dropdown
                    style={[styles.dropdown, isDarkMode && styles.darkDropdown]}
                    placeholderStyle={[styles.placeholderText, isDarkMode && styles.darkText]}
                    selectedTextStyle={[styles.selectedText, isDarkMode && styles.darkText]}
                    containerStyle={[styles.dropdownContainer, isDarkMode && styles.darkDropdownContainer]}
                    itemContainerStyle={styles.dropdownItemContainer}
                    itemTextStyle={[styles.dropdownItemText, isDarkMode && styles.darkText]}
                    data={getChargeReasons().map((reason) => ({ 
                      label: reason.description ? `${reason.name} - ${reason.description}` : reason.name,
                      value: reason.id,
                      reason: reason 
                    }))}
                    labelField="label"
                    valueField="value"
                    placeholder="Select Charge Reason"
                    value={selectedChargeReason?.id || null}
                    onChange={(item) => {
                      const reason = getChargeReasons().find(r => r.id === item.value);
                      setSelectedChargeReason(reason || null);
                    }}
                    search
                    searchPlaceholder="Search Charge Reasons"
                    maxHeight={300}
                    dropdownPosition="bottom"
                  />
                )}
              </View>

              {/* Amount Input */}
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Amount *</Text>
                <TextInput
                  style={styles.amountInput}
                  value={chargeAmount}
                  onChangeText={setChargeAmount}
                  placeholder="0.00"
                  keyboardType="numeric"
                  returnKeyType="next"
                />
              </View>

              {/* Description Input */}
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Additional Notes (optional)</Text>
                <TextInput
                  style={styles.descriptionInput}
                  value={chargeDescription}
                  onChangeText={setChargeDescription}
                  placeholder="Additional details about this charge..."
                  multiline
                  numberOfLines={3}
                  returnKeyType="done"
                />
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View style={styles.chargeModalActions}>
              <TouchableOpacity
                style={[
                  styles.cancelChargeButton,
                  isSubmittingCharge && { opacity: 0.5 }
                ]}
                onPress={() => {
                  setShowChargeModal(false);
                  setSelectedPlayer(null);
                  setSelectedChargeReason(null);
                  setChargeAmount('');
                  setChargeDescription('');
                }}
                disabled={isSubmittingCharge}
              >
                <Text style={styles.cancelChargeButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.addChargeButton,
                  ((!selectedChargeReason || !chargeAmount.trim()) || isSubmittingCharge) && styles.disabledButton
                ]}
                onPress={handleSubmitCharge}
                disabled={(!selectedChargeReason || !chargeAmount.trim()) || isSubmittingCharge}
              >
                <Text style={styles.addChargeButtonText}>
                  {isSubmittingCharge ? 'Adding...' : 'Add Charge'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  darkHeader: {
    backgroundColor: '#2a2a2a',
    borderBottomColor: '#444',
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  darkHeaderTitle: {
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  darkHeaderSubtitle: {
    color: '#ccc',
  },
  syncBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#f44336',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  globeIcon: {
    marginHorizontal: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  addButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  syncButton: {
    backgroundColor: '#2196F3',
    borderRadius: 20,
    padding: 8,
    position: 'relative',
  },
  syncButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  searchInput: {
    margin: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#333',
  },
  darkSearchInput: {
    backgroundColor: '#333',
    borderColor: '#555',
    color: '#fff',
  },
  listContainer: {
    padding: 16,
  },
  playerList: {
    flex: 1,
  },
  playerItem: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  darkPlayerItem: {
    backgroundColor: '#2a2a2a',
    shadowColor: '#fff',
    shadowOpacity: 0.05,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  darkPlayerName: {
    color: '#fff',
  },
  playerDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  darkPlayerDetails: {
    color: '#ccc',
  },
  playerBalance: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  playerStats: {
    fontSize: 12,
    color: '#999',
  },
  darkPlayerStats: {
    color: '#bbb',
  },
  assignedUser: {
    fontSize: 12,
    color: '#FF9800',
    fontWeight: 'bold',
    marginTop: 2,
  },
  playerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  balanceButton: {
    backgroundColor: '#4CAF50',
  },
  assignButton: {
    backgroundColor: '#FF9800',
  },
  deleteButton: {
    backgroundColor: '#f44336',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  deleteButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  cancelButton: {
    color: '#2196F3',
    fontSize: 16,
  },
  form: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  halfInput: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  helpText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  dropdownButton: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownButtonText: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#666',
  },
  dropdownList: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 16,
    maxHeight: 200,
  },
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dropdownItemText: {
    fontSize: 16,
    color: '#333',
  },
  
  // Charge Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chargeModal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '95%',
    maxWidth: 500,
    height: '85%',
    maxHeight: 700,
  },
  chargeModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  chargeModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  chargeModalContent: {
    flex: 1,
    padding: 20,
    paddingBottom: 10,
  },
  balanceInfo: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  balanceAmount: {
    fontSize: 16,
    color: '#dc3545',
    fontWeight: '600',
  },
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    marginBottom: 8,
  },
  noReasonsContainer: {
    backgroundColor: '#fff3cd',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  noReasonsText: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
  },

  reasonDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
    fontStyle: 'italic',
  },
  // Dropdown styles
  dropdown: {
    height: 50,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
    zIndex: 1000,
    ...Platform.select({
      android: {
        elevation: 5,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
    }),
  },
  darkDropdown: {
    backgroundColor: '#333',
    borderColor: '#555',
  },
  placeholderText: {
    fontSize: 16,
    color: '#999',
  },
  selectedText: {
    fontSize: 16,
    color: '#333',
  },
  darkText: {
    color: '#fff',
  },
  dropdownContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    maxHeight: 300,
    zIndex: 9999,
    ...Platform.select({
      android: {
        elevation: 10,
        marginTop: 5,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
    }),
  },
  darkDropdownContainer: {
    backgroundColor: '#333',
    borderColor: '#555',
  },
  dropdownItemContainer: {
    backgroundColor: 'transparent',
  },
  amountInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  descriptionInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chargeModalActions: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    gap: 12,
  },
  cancelChargeButton: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  cancelChargeButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  addChargeButton: {
    flex: 1,
    backgroundColor: '#007bff',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  addChargeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
});