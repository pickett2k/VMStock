import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Dimensions,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';
import { MaterialIcons } from '@expo/vector-icons';
import { hybridSyncService } from '../services/HybridSyncService';
import { useAuth } from '../contexts/AuthContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { useTheme } from '../app/ThemeContext';
import { formatCurrency, getCurrencySymbol } from '../utils/currency';
import { formatUKDateTime } from '../utils/dateUtils';
import { generateUUID } from '../utils/uuid';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  isActive?: boolean;
}

interface Player {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  balance?: number;
  totalSpent?: number;
  totalPurchases?: number;
}

interface Assignment {
  id: string;
  productId: string;
  productName: string;
  userName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  date: string;
  paid?: boolean;
  cancelled?: boolean;
  notes?: string;
  organizationId: string;
  // Legacy compatibility fields
  user?: string;
  product?: string;
  createdAt?: string;
  updatedAt?: string | number;
}

export default function AssignmentsPage() {
  const { user, isAdmin, assignedPlayer } = useAuth();
  const { organization: currentOrganization } = useOrganization();
  const { isDarkMode } = useTheme();
  
  // Core data
  const [products, setProducts] = useState<Product[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  
  // Form state - using same naming as original
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<string>('1');
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [syncQueueLength, setSyncQueueLength] = useState(0);
  const [editMode, setEditMode] = useState<number | null>(null);

  const updateNetworkStatus = async () => {
    // Force refresh network state to get accurate reading
    const freshNetworkState = await hybridSyncService.refreshNetworkState();
    const queueLength = hybridSyncService.getSyncQueueLength();
    
    // Only log network status changes, not every check
    if (freshNetworkState !== isOnline) {
      console.log('🌐 Network Status Changed:', { 
        from: isOnline ? 'Online' : 'Offline',
        to: freshNetworkState ? 'Online' : 'Offline',
        queueLength: queueLength,
        timestamp: new Date().toLocaleTimeString()
      });
    }
    
    setIsOnline(freshNetworkState);
    setSyncQueueLength(queueLength);
  };

  // Load all data on mount
  useEffect(() => {
    loadAllData();
    updateNetworkStatus();
    
    // Update network status every 2 seconds
    const networkInterval = setInterval(() => {
      updateNetworkStatus();
    }, 2000);

    return () => clearInterval(networkInterval);
  }, []); // Remove dependencies to prevent constant reloading

  // Separate effect to handle permission changes without reloading data
  useEffect(() => {
    console.log('👤 AssignmentsPage - User permissions updated:', { isAdmin, assignedPlayer: assignedPlayer?.name });
    // Permission changes don't require data reload, just UI updates
  }, [isAdmin, assignedPlayer]);

  const loadAllData = async () => {
    try {
      setLoading(true);
      console.log('🔄 Loading all data...');

      // Load products, players, and assignments concurrently
      const [productsData, playersData, assignmentsData] = await Promise.all([
        hybridSyncService.getProductsWithOverlay(), // Use overlay to show provisional stock changes
        hybridSyncService.getPlayersWithOverlay(), // Use overlay to show provisional balance changes
        hybridSyncService.getAssignmentsWithOverlay() // Use overlay to show provisional assignments
      ]);

      console.log('✅ Data loaded:', {
        products: productsData.length,
        players: playersData.length,
        assignments: assignmentsData.length
      });

      setProducts(productsData.filter(p => p.isActive !== false));
      setPlayers(playersData);
      setAssignments(assignmentsData);
      
      // Convert player objects to names for the dropdown using consistent logic
      const playerNames = playersData.map((player: any) => {
        // Always prioritize the 'name' field if it exists, as that's what's stored in Firebase
        if (player.name) {
          return player.name;
        } else if (player.firstName && player.lastName) {
          return `${player.firstName} ${player.lastName}`;
        } else if (player.firstName) {
          return player.firstName;
        } else {
          return player.id || 'Unknown Player';
        }
      });
      setUsers(playerNames);

      // For regular users, auto-select their assigned player using consistent name format
      if (!isAdmin && assignedPlayer) {
        let playerName: string;
        if (assignedPlayer.name) {
          playerName = assignedPlayer.name;
        } else if (assignedPlayer.firstName && assignedPlayer.lastName) {
          playerName = `${assignedPlayer.firstName} ${assignedPlayer.lastName}`;
        } else if (assignedPlayer.firstName) {
          playerName = assignedPlayer.firstName;
        } else {
          playerName = assignedPlayer.id || 'Unknown Player';
        }
        setSelectedUser(playerName);
        console.log('👤 Auto-selected player for regular user:', playerName);
      }

    } catch (error) {
      console.error('❌ Error loading data:', error);
      Alert.alert('Error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const createAssignment = async () => {
    console.log('🚀 CREATE ASSIGNMENT FUNCTION CALLED!', { selectedUser, selectedProduct, quantity });
    
    // Validation
    if (!selectedUser) {
      Alert.alert('Error', 'Please select a player');
      return;
    }
    if (!selectedProduct) {
      Alert.alert('Error', 'Please select a product');
      return;
    }
    const quantityNum = parseInt(quantity);
    if (quantityNum < 1) {
      Alert.alert('Error', 'Quantity must be at least 1');
      return;
    }

    // Find selected player by name (same as original)
    const selectedPlayerObj = players.find(p => p.name === selectedUser);
    const selectedProductObj = products.find(p => p.id === selectedProduct);

    if (!selectedPlayerObj || !selectedProductObj) {
      Alert.alert('Error', 'Invalid player or product selection');
      return;
    }

    // Check stock
    if (selectedProductObj.stock < quantityNum) {
      Alert.alert('Error', `Not enough stock. Available: ${selectedProductObj.stock}`);
      return;
    }

    try {
      setCreating(true);
      
      // Enhanced debugging for offline issues
      const currentNetworkState = await hybridSyncService.refreshNetworkState();
      console.log('� NETWORK STATE DEBUG:', {
        isOnlineState: isOnline,
        actualNetworkState: currentNetworkState,
        syncQueueLength: hybridSyncService.getSyncQueueLength()
      });
      
      console.log('🔍 PRE-ASSIGNMENT DEBUG:', {
        selectedPlayerObj: selectedPlayerObj,
        selectedProductObj: selectedProductObj,
        networkState: currentNetworkState,
        productsCount: products.length,
        playersCount: players.length,
        assignmentsCount: assignments.length
      });
      
      console.log('�🎯 Creating assignment:', {
        playerName: selectedPlayerObj.name,
        productId: selectedProductObj.id,
        productName: selectedProductObj.name,
        quantity: quantityNum,
        unitPrice: selectedProductObj.price,
        total: selectedProductObj.price * quantityNum
      });

      // Use compound transaction for better data integrity
      console.log('💰 Creating assignment transaction (single atomic operation)');
      
      const transactionData = {
        productId: selectedProductObj.id,
        productName: selectedProductObj.name,
        userName: selectedPlayerObj.name,
        playerId: selectedPlayerObj.id,
        quantity: quantityNum,
        unitPrice: selectedProductObj.price,
        total: selectedProductObj.price * quantityNum,
        date: new Date().toISOString(),
        paid: false,
        notes: 'Sale transaction',
        organizationId: currentOrganization?.id || 'unknown'
      };
      
      console.log('🔄 Creating assignment transaction (atomic):', {
        player: selectedPlayerObj.name,
        product: selectedProductObj.name,
        quantity: quantityNum,
        total: selectedProductObj.price * quantityNum
      });
      
      console.log('🔍 ASSIGNMENT DEBUG - Product IDs:', {
        selectedProduct: selectedProduct,
        selectedProductObj_id: selectedProductObj.id,
        transactionData_productId: transactionData.productId,
        selectedProductObj_name: selectedProductObj.name
      });
      
      console.log('📋 Final Assignment Transaction Data:', transactionData);
      
      const assignmentId = await hybridSyncService.createAssignmentTransaction(transactionData);
      console.log('✅ Assignment transaction completed - all updates atomic:', assignmentId);

      // Reset form
      setSelectedUser('');
      setSelectedProduct('');
      setQuantity('1');

      // Reload data to reflect changes
      await loadAllData();

      Alert.alert('Success', 'Assignment created successfully');

    } catch (error) {
      console.error('❌ Error creating assignment:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace available';
      
      console.error('❌ Error stack:', errorStack);
      console.error('❌ Error details:', {
        message: errorMessage,
        selectedUser: selectedUser,
        selectedProduct: selectedProduct,  
        quantity: quantity,
        isOnline: isOnline,
        productsAvailable: products.length,
        playersAvailable: players.length,
        selectedPlayerObj: selectedPlayerObj,
        selectedProductObj: selectedProductObj
      });
      Alert.alert('Error', `Failed to create assignment: ${errorMessage}`);
    } finally {
      setCreating(false);
    }
  };

  const editAssignment = (index: number) => {
    const assignment = assignments[index];
    // Pre-populate the main form instead of creating separate edit form
    setSelectedUser(assignment.userName || assignment.user || null);
    
    // Find product ID from the stored product name/ID
    const productToEdit = products.find(p => 
      p.id === assignment.productId || 
      p.name === (assignment.productName || assignment.product)
    );
    setSelectedProduct(productToEdit?.id || null);
    
    setQuantity(assignment.quantity?.toString() || '1');
    setEditMode(index);
  };

  const saveEditAssignment = async () => {
    if (editMode === null) return;
    
    try {
      const assignment = assignments[editMode];
      const selectedProductData = products.find(p => p.id === selectedProduct);
      const oldQuantity = assignment.quantity || 0;
      const newQuantity = parseInt(quantity) || 1;
      const quantityDiff = newQuantity - oldQuantity;
      
      if (!selectedProductData) {
        Alert.alert('Error', 'Selected product not found');
        return;
      }

      // Check stock availability if increasing quantity
      if (quantityDiff > 0 && selectedProductData.stock < quantityDiff) {
        Alert.alert('Error', `Insufficient stock. Available: ${selectedProductData.stock}`);
        return;
      }

      // Calculate the difference in total cost
      const oldTotal = assignment.total || (assignment.quantity * selectedProductData.price);
      const newTotal = selectedProductData.price * newQuantity;

      // Update assignment using single operation
      const updatedAssignment: Assignment = {
        ...assignment,
        userName: selectedUser || assignment.userName,
        productName: selectedProductData.name,
        quantity: newQuantity,
        total: newTotal,
        updatedAt: Date.now()
      };

      // Use proper transactional update method
      console.log('📝 AssignmentsPage: Updating assignment via transactional method:', assignment.id);
      
      // Create update operation
      const operation = {
        id: generateUUID(),
        type: 'update' as const,
        collection: 'assignments' as const,
        entityId: assignment.id,
        data: updatedAssignment,
        metadata: {
          deviceId: 'local',
          timestamp: Date.now(),
          version: 0,
          vectorClock: {},
          source: 'local' as const
        }
      };

      await hybridSyncService.applyOp(operation);

      // Refresh data to show changes
      await loadAllData();

      // Clear form and exit edit mode
      setEditMode(null);
      setSelectedUser(null);
      setSelectedProduct(null);  
      setQuantity('1');

      Alert.alert('Success', 'Assignment updated successfully');
    } catch (error) {
      console.error('Error updating assignment:', error);
      Alert.alert('Error', 'Failed to update assignment');
    }
  };

  const cancelEdit = () => {
    setEditMode(null);
    setSelectedUser(null);
    setSelectedProduct(null);
    setQuantity('1');
  };

  const deleteAssignment = async (index: number) => {
    const assignmentToDelete = assignments[index];
    
    // Show confirmation dialog
    Alert.alert(
      'Delete Assignment',
      `Are you sure you want to delete this assignment?\n\n${assignmentToDelete.quantity}x ${assignmentToDelete.productName || assignmentToDelete.product}\n\nThis will:\n• Remove the assignment\n• Refund the player's balance\n• Restore product stock\n• Remove from purchase history`,
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
              console.log('🗑️ AssignmentsPage: Deleting assignment via transactional method:', assignmentToDelete.id);
              
              if (!assignmentToDelete.id) {
                throw new Error('Assignment ID is required for deletion');
              }

              // Use the proper transactional delete method
              await hybridSyncService.deleteEntity('assignments', assignmentToDelete.id);

              // Refresh assignments to show changes
              await loadAllData();
              
              Alert.alert('Success', 'Assignment deleted successfully');
              console.log('✅ AssignmentsPage: Assignment deleted successfully');
            } catch (error) {
              console.error('❌ AssignmentsPage: Error deleting assignment:', error);
              Alert.alert('Error', 'Failed to delete assignment. Please try again.');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const selectedProductObj = products.find(p => p.id === selectedProduct);
  const selectedPlayerObj = players.find(p => p.name === selectedUser);
  const quantityNum = parseInt(quantity) || 1;
  const total = selectedProductObj ? selectedProductObj.price * quantityNum : 0;

  // Debug button state
  console.log('🔍 BUTTON DEBUG:', {
    selectedUser: selectedUser,
    selectedProduct: selectedProduct,
    creating: creating,
    buttonDisabled: creating || !selectedUser || !selectedProduct,
    playerFound: !!selectedPlayerObj,
    productFound: !!selectedProductObj
  });

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={[styles.container, isDarkMode && styles.darkContainer]}>
        {/* Header */}
        <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>
            {isAdmin ? 'Sell Products' : 'Buy Products'}
          </Text>
          <Text style={[styles.headerSubtitle, isDarkMode && styles.darkSubtitle]}>
            {isAdmin ? 'Record Sales' : 'Make Purchases'}
          </Text>
        </View>
      </View>

      {/* Player Selection - Only show for admins */}
      {isAdmin && (
        <Dropdown
          style={[styles.dropdown, isDarkMode && styles.darkDropdown]}
          placeholderStyle={[styles.placeholderText, isDarkMode && styles.darkText]}
          selectedTextStyle={[styles.selectedText, isDarkMode && styles.darkText]}
          containerStyle={[styles.dropdownContainer, isDarkMode && styles.darkDropdownContainer]}
          itemContainerStyle={styles.dropdownItemContainer}
          itemTextStyle={[styles.dropdownItemText, isDarkMode && styles.darkText]}
          data={users.map((user) => ({ label: user, value: user }))}
          labelField="label"
          valueField="value"
          placeholder="Select Player"
          value={selectedUser}
          onChange={(item) => setSelectedUser(item.value)}
          search
          searchPlaceholder="Search Player"
          maxHeight={300}
          dropdownPosition="bottom"
        />
      )}

      {/* Product Selection */}
      <Dropdown
        style={[styles.dropdown, isDarkMode && styles.darkDropdown]}
        placeholderStyle={[styles.placeholderText, isDarkMode && styles.darkText]}
        selectedTextStyle={[styles.selectedText, isDarkMode && styles.darkText]}
        containerStyle={[styles.dropdownContainer, isDarkMode && styles.darkDropdownContainer]}
        itemContainerStyle={styles.dropdownItemContainer}
        itemTextStyle={[styles.dropdownItemText, isDarkMode && styles.darkText]}
        data={products.map((product) => ({ 
          label: `${product.name} - ${formatCurrency(product.price, currentOrganization?.currency || 'GBP')}`, 
          value: product.id,
          stockLevel: product.stock
        }))}
        labelField="label"
        valueField="value"
        placeholder="Select Product"
        value={selectedProduct}
        onChange={(item) => setSelectedProduct(item.value)}
        search
        searchPlaceholder="Search Product"
        maxHeight={300}
        dropdownPosition="bottom"
        renderItem={(item) => (
          <View style={styles.dropdownItem}>
            <Text style={[
              styles.dropdownItemText,
              item.stockLevel === 0 ? styles.outOfStockText : 
              item.stockLevel < 3 ? styles.lowStockText : styles.inStockText,
              isDarkMode && styles.darkText
            ]}>
              {item.label}
            </Text>
          </View>
        )}
      />

      {/* Quantity Input */}
      <TextInput
        style={[styles.input, isDarkMode && styles.darkInput]}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="numeric"
        placeholder="Enter Quantity"
        placeholderTextColor={isDarkMode ? '#aaa' : '#666'}
        returnKeyType="done"
        onSubmitEditing={Keyboard.dismiss}
        onBlur={() => {
          if (!quantity) {
            setQuantity('1');
          }
        }}
      />

      {/* Summary */}
      {selectedPlayerObj && selectedProductObj && (
        <View style={[styles.summary, isDarkMode && styles.darkSummary]}>
          <Text style={[styles.summaryTitle, isDarkMode && styles.darkText]}>Order Summary:</Text>
          <Text style={[styles.summaryText, isDarkMode && styles.darkText]}>Player: {selectedPlayerObj.name}</Text>
          <Text style={[styles.summaryText, isDarkMode && styles.darkText]}>Product: {selectedProductObj.name}</Text>
          <Text style={[styles.summaryText, isDarkMode && styles.darkText]}>Quantity: {quantityNum}</Text>
          <Text style={[styles.summaryText, isDarkMode && styles.darkText]}>Unit Price: {formatCurrency(selectedProductObj.price, currentOrganization?.currency || 'GBP')}</Text>
          <Text style={[styles.total, isDarkMode && styles.darkTotal]}>Total: {formatCurrency(total, currentOrganization?.currency || 'GBP')}</Text>
        </View>
      )}

      {/* Add/Update Assignment Button */}
      <TouchableOpacity 
        style={[styles.createButton, creating && styles.buttonDisabled]} 
        onPress={editMode !== null ? saveEditAssignment : createAssignment}
        disabled={creating || !selectedUser || !selectedProduct}
      >
        {creating ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.createButtonText}>
            {editMode !== null 
              ? 'Update Assignment' 
              : (isAdmin ? 'Sell Product' : 'Buy Product')
            }
          </Text>
        )}
      </TouchableOpacity>

      <ScrollView style={styles.assignmentList}>
        <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>
          {isAdmin ? 'Recent Sales (Last 10)' : 'Your Recent Purchases (Last 10)'}
        </Text>
        
        {editMode !== null && (
          <View style={[styles.editContainer, isDarkMode && styles.darkEditContainer]}>
            <Text style={[styles.editTitle, isDarkMode && styles.darkText]}>
              Editing Assignment - Update the form above and click "Update Assignment"
            </Text>
            <View style={styles.editButtons}>
              <TouchableOpacity onPress={cancelEdit} style={[styles.cancelButton, isDarkMode && styles.darkCancelButton]}>
                <Text style={[styles.cancelButtonText, isDarkMode && styles.darkCancelButtonText]}>Cancel Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        
        {assignments
          .filter((item) => {
            // No longer filter by paid status - show all recent sales
            // Filter out cancelled items only
            if (item.cancelled) return false;
            
            // For regular users, only show their own purchases
            if (!isAdmin && assignedPlayer) {
              const playerName = assignedPlayer.name || `${assignedPlayer.firstName} ${assignedPlayer.lastName}`;
              return item.userName === playerName || item.user === playerName;
            }
            
            // For admins, show all
            return true;
          })
          .sort((a, b) => {
            // Sort by date descending (newest first)
            const dateA = new Date(a.date || a.createdAt || a.updatedAt || 0);
            const dateB = new Date(b.date || b.createdAt || b.updatedAt || 0);
            return dateB.getTime() - dateA.getTime();
          })
          .slice(0, 10) // Only show last 10 sales
          .map((item, index) => (
            <TouchableOpacity
              key={index}
              onLongPress={isAdmin && !item.paid ? () => {
                Alert.alert('Assignment Actions', 'What would you like to do?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Edit', onPress: () => editAssignment(index) },
                  { text: 'Delete', style: 'destructive', onPress: () => deleteAssignment(index) },
                ]);
              } : isAdmin && item.paid ? () => {
                Alert.alert('Paid Assignment', 'This assignment has been paid and cannot be edited or deleted.\n\nTo remove paid assignments, use "Reset Sales Data" from the admin menu.', [
                  { text: 'OK', style: 'default' }
                ]);
              } : undefined}
            >
              <View style={[
                styles.assignmentContainer, 
                isDarkMode && styles.darkAssignmentContainer,
                item.paid && styles.paidAssignmentContainer,
                item.paid && isDarkMode && styles.darkPaidAssignmentContainer
              ]}>
                <Text style={[styles.assignmentText, isDarkMode && styles.darkAssignmentText]}>
                  {item.userName || item.user || 'Unknown'} - {item.quantity} x {item.productName || item.product} = {formatCurrency(typeof item.total === 'number' ? item.total : 0, currentOrganization?.currency || 'GBP')}
                </Text>
                <Text style={[styles.assignmentSubText, isDarkMode && styles.darkAssignmentSubText]}>
                  {formatUKDateTime(item.date || item.createdAt || item.updatedAt || new Date().toISOString())} • {item.paid ? '✅ Paid' : '💳 Unpaid'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
      </ScrollView>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  // Header styles
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    alignItems: 'center',
    position: 'relative',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#666',
    fontStyle: 'italic',
  },
  darkSubtitle: {
    color: '#aaa',
  },
  syncBadge: {
    fontSize: 10,
    backgroundColor: '#ff9800',
    color: 'white',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontWeight: 'bold',
    textAlign: 'center',
    minWidth: 16,
  },

  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  darkText: {
    color: '#fff',
  },
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
  // Dropdown container and item styles
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
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  dropdownItemText: {
    fontSize: 16,
  },
  outOfStockText: {
    color: '#d32f2f',
  },
  lowStockText: {
    color: '#f57c00',
  },
  inStockText: {
    color: '#333',
  },
  input: {
    height: 50,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
    fontSize: 16,
    color: '#333',
  },
  darkInput: {
    backgroundColor: '#333',
    borderColor: '#555',
    color: '#fff',
  },
  summary: {
    backgroundColor: '#e8f4f8',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  darkSummary: {
    backgroundColor: '#2a2a2a',
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  summaryText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  total: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#007AFF',
    marginTop: 4,
  },
  darkTotal: {
    color: '#4da6ff',
  },
  createButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  createButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  assignmentList: {
    flex: 1,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  assignmentItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  assignmentText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  assignmentPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    marginHorizontal: 8,
  },
  assignmentStatus: {
    fontSize: 12,
    color: '#666',
  },
  // Edit Mode Styles
  editContainer: {
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#007bff',
  },
  darkEditContainer: {
    backgroundColor: '#2a2a3a',
    borderColor: '#4CAF50',
  },
  editTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    color: '#007bff',
  },
  editButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 10,
  },
  cancelButton: {
    backgroundColor: '#6c757d',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 5,
    flex: 0.4,
  },
  darkCancelButton: {
    backgroundColor: '#5a6268',
  },
  cancelButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: '500',
  },
  darkCancelButtonText: {
    color: '#fff',
  },
  // Assignment list styles
  assignmentContainer: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  darkAssignmentContainer: {
    borderBottomColor: '#444',
  },
  darkAssignmentText: {
    color: '#fff',
  },
  // Paid assignment styles
  paidAssignmentContainer: {
    backgroundColor: '#f0f9ff',
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  darkPaidAssignmentContainer: {
    backgroundColor: '#1a2e1a',
    borderLeftColor: '#4CAF50',
  },
  assignmentSubText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  darkAssignmentSubText: {
    color: '#ccc',
  },
});