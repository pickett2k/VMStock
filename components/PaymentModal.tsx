import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Alert
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../app/ThemeContext';
import { paymentService, PaymentMethod, PaymentRequest, PaymentResult } from '../services/PaymentService';

const { width } = Dimensions.get('window');

interface PaymentModalProps {
  visible: boolean;
  onClose: () => void;
  playerName: string;
  amount: number;
  assignmentIds: string[];
  playerId: string;
  onPaymentComplete: (result: PaymentResult) => void;
}

export default function PaymentModal({
  visible,
  onClose,
  playerName,
  amount,
  assignmentIds,
  playerId,
  onPaymentComplete
}: PaymentModalProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const { isDarkMode } = useTheme();

  useEffect(() => {
    if (visible) {
      loadPaymentMethods();
    }
  }, [visible]);

  const loadPaymentMethods = async () => {
    try {
      await paymentService.initializeSumUp();
      const methods = await paymentService.getAvailablePaymentMethods();
      setPaymentMethods(methods);
      
      // Auto-select first available method
      const availableMethod = methods.find(m => m.available);
      if (availableMethod) {
        setSelectedMethod(availableMethod);
      }
    } catch (error) {
      console.error('Failed to load payment methods:', error);
      Alert.alert('Error', 'Failed to load payment methods');
    }
  };

  const handlePayment = async () => {
    if (!selectedMethod) {
      Alert.alert('Error', 'Please select a payment method');
      return;
    }

    setProcessing(true);
    setProcessingMessage(getProcessingMessage(selectedMethod));

    try {
      const request: PaymentRequest = {
        amount,
        currency: 'GBP',
        description: `Payment from ${playerName}`,
        playerId,
        playerName,
        assignmentIds
      };

      const result = await paymentService.processPayment(request, selectedMethod);
      
      if (result.success) {
        Alert.alert(
          'Payment Successful',
          `£${amount.toFixed(2)} payment processed successfully`,
          [
            {
              text: 'OK',
              onPress: () => {
                onPaymentComplete(result);
                onClose();
              }
            }
          ]
        );
      } else {
        Alert.alert('Payment Failed', result.error || 'Unknown error occurred');
      }
    } catch (error: any) {
      Alert.alert('Payment Error', error.message || 'Payment processing failed');
    } finally {
      setProcessing(false);
      setProcessingMessage('');
    }
  };

  const getProcessingMessage = (method: PaymentMethod): string => {
    switch (method.id) {
      case 'stripe_terminal_nfc':
        return 'Hold card near device for NFC payment...';
      case 'stripe_card':
        return 'Processing card payment via Stripe...';
      case 'manual':
        return 'Confirming payment...';
      default:
        switch (method.type) {
          case 'nfc':
            return 'Present card to device or hold near phone...';
          case 'hardware':
            return 'Follow instructions on card reader...';
          default:
            return 'Processing payment...';
        }
    }
  };

  const getMethodIcon = (method: PaymentMethod) => {
    switch (method.id) {
      case 'manual':
        return 'check-circle';
      case 'stripe_card':
        return 'credit-card';
      case 'stripe_terminal_nfc':
        return 'contactless-payment';
      case 'sumup_nfc':
        return 'contactless-payment';
      case 'sumup_hardware':
        return 'credit-card-outline';
      default:
        return 'cash';
    }
  };

  const getMethodColor = (method: PaymentMethod) => {
    if (!method.available) return '#ccc';
    
    switch (method.id) {
      case 'stripe_card':
        return '#6772e5'; // Stripe brand color
      case 'stripe_terminal_nfc':
        return '#00d4aa'; // Stripe Terminal green
      case 'manual':
        return '#4CAF50';
      default:
        switch (method.type) {
          case 'nfc':
            return '#2196F3';
          case 'hardware':
            return '#FF9800';
          default:
            return '#757575';
        }
    }
  };

  if (processing) {
    return (
      <Modal visible={visible} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.processingContainer, isDarkMode && styles.darkProcessingContainer]}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={[styles.processingTitle, isDarkMode && styles.darkProcessingTitle]}>
              Processing Payment
            </Text>
            <Text style={[styles.processingMessage, isDarkMode && styles.darkProcessingMessage]}>
              {processingMessage}
            </Text>
            <Text style={[styles.processingAmount, isDarkMode && styles.darkProcessingAmount]}>
              £{amount.toFixed(2)}
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent={true} animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContainer, isDarkMode && styles.darkModalContainer]}>
          {/* Header */}
          <View style={[styles.header, isDarkMode && styles.darkHeader]}>
            <View style={styles.headerLeft}>
              <Icon name="credit-card" size={24} color={isDarkMode ? '#fff' : '#333'} />
              <Text style={[styles.headerTitle, isDarkMode && styles.darkHeaderTitle]}>
                Payment Options
              </Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#333'} />
            </TouchableOpacity>
          </View>

          {/* Payment Details */}
          <View style={[styles.paymentDetails, isDarkMode && styles.darkPaymentDetails]}>
            <Text style={[styles.playerName, isDarkMode && styles.darkPlayerName]}>
              {playerName}
            </Text>
            <Text style={[styles.paymentAmount, isDarkMode && styles.darkPaymentAmount]}>
              £{amount.toFixed(2)}
            </Text>
            <Text style={[styles.itemCount, isDarkMode && styles.darkItemCount]}>
              {assignmentIds.length} item{assignmentIds.length !== 1 ? 's' : ''}
            </Text>
          </View>

          {/* Payment Methods */}
          <ScrollView style={styles.methodsList} showsVerticalScrollIndicator={false}>
            <Text style={[styles.sectionTitle, isDarkMode && styles.darkSectionTitle]}>
              Select Payment Method
            </Text>
            
            {paymentMethods.map((method) => (
              <TouchableOpacity
                key={method.id}
                style={[
                  styles.methodItem,
                  isDarkMode && styles.darkMethodItem,
                  selectedMethod?.id === method.id && styles.selectedMethodItem,
                  selectedMethod?.id === method.id && isDarkMode && styles.darkSelectedMethodItem,
                  !method.available && styles.disabledMethodItem
                ]}
                onPress={() => method.available && setSelectedMethod(method)}
                disabled={!method.available}
              >
                <View style={styles.methodLeft}>
                  <View style={[
                    styles.methodIcon,
                    { backgroundColor: getMethodColor(method) + '20' }
                  ]}>
                    <Icon 
                      name={getMethodIcon(method)} 
                      size={24} 
                      color={getMethodColor(method)}
                    />
                  </View>
                  <View style={styles.methodInfo}>
                    <Text style={[
                      styles.methodName,
                      isDarkMode && styles.darkMethodName,
                      !method.available && styles.disabledMethodName
                    ]}>
                      {method.name}
                    </Text>
                    <Text style={[
                      styles.methodDescription,
                      isDarkMode && styles.darkMethodDescription,
                      !method.available && styles.disabledMethodDescription
                    ]}>
                      {method.available ? method.description : 'Not available'}
                    </Text>
                  </View>
                </View>
                
                {selectedMethod?.id === method.id && (
                  <Icon name="check-circle" size={20} color="#4CAF50" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.cancelButton, isDarkMode && styles.darkCancelButton]}
              onPress={onClose}
            >
              <Text style={[styles.cancelButtonText, isDarkMode && styles.darkCancelButtonText]}>
                Cancel
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.payButton,
                isDarkMode && styles.darkPayButton,
                (!selectedMethod || !selectedMethod.available) && styles.disabledPayButton
              ]}
              onPress={handlePayment}
              disabled={!selectedMethod || !selectedMethod.available}
            >
              <Icon name="check" size={16} color="#fff" />
              <Text style={styles.payButtonText}>
                Pay £{amount.toFixed(2)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    width: width * 0.9,
    maxWidth: 400,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  darkModalContainer: {
    backgroundColor: '#1e1e1e',
  },
  
  // Processing styles
  processingContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    minWidth: 250,
  },
  darkProcessingContainer: {
    backgroundColor: '#1e1e1e',
  },
  processingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  darkProcessingTitle: {
    color: '#fff',
  },
  processingMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  darkProcessingMessage: {
    color: '#999',
  },
  processingAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  darkProcessingAmount: {
    color: '#4A90E2',
  },

  // Header styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  darkHeader: {
    borderBottomColor: '#333',
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginLeft: 12,
  },
  darkHeaderTitle: {
    color: '#fff',
  },
  closeButton: {
    padding: 8,
  },

  // Payment details styles
  paymentDetails: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  darkPaymentDetails: {
    borderBottomColor: '#333',
  },
  playerName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  darkPlayerName: {
    color: '#fff',
  },
  paymentAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#e53e3e',
    marginBottom: 4,
  },
  darkPaymentAmount: {
    color: '#ff6b6b',
  },
  itemCount: {
    fontSize: 14,
    color: '#666',
  },
  darkItemCount: {
    color: '#999',
  },

  // Methods list styles
  methodsList: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  darkSectionTitle: {
    color: '#fff',
  },
  methodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 12,
  },
  darkMethodItem: {
    borderColor: '#333',
  },
  selectedMethodItem: {
    borderColor: '#4CAF50',
    backgroundColor: '#4CAF50' + '10',
  },
  darkSelectedMethodItem: {
    borderColor: '#4CAF50',
    backgroundColor: '#4CAF50' + '20',
  },
  disabledMethodItem: {
    opacity: 0.5,
  },
  methodLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  methodInfo: {
    flex: 1,
  },
  methodName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 2,
  },
  darkMethodName: {
    color: '#fff',
  },
  disabledMethodName: {
    color: '#999',
  },
  methodDescription: {
    fontSize: 13,
    color: '#666',
  },
  darkMethodDescription: {
    color: '#999',
  },
  disabledMethodDescription: {
    color: '#ccc',
  },

  // Action buttons styles
  actionButtons: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingVertical: 14,
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
  payButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  darkPayButton: {
    backgroundColor: '#2E7D32',
  },
  disabledPayButton: {
    backgroundColor: '#ccc',
  },
  payButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});