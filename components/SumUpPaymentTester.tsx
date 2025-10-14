import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';

import { SumUpWebAPI, createSumUpAPI } from '../services/SumUpWebAPI';

interface PaymentResult {
  success: boolean;
  transactionId?: string;
  amount?: number;
  message: string;
  paymentMethod?: string;
}

export default function SumUpPaymentTester() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<PaymentResult | null>(null);
  const [initializationLog, setInitializationLog] = useState<string[]>([]);
  const [sumUpAPI, setSumUpAPI] = useState<SumUpWebAPI | null>(null);

  const addLog = (message: string) => {
    setInitializationLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    console.log(`SumUp: ${message}`);
  };

  // Initialize SumUp API
  const initializeSumUp = async () => {
    try {
      addLog('Starting SumUp API initialization...');
      
      // Create SumUp API instance with your credentials
      const api = createSumUpAPI();
      setSumUpAPI(api);

      addLog('🔧 Using SumUp Web API');
      addLog('🏪 Merchant Code: CCCVLMNUE');
      addLog('🌍 Environment: sandbox (test mode)');
      addLog('🔗 Testing API credentials...');

      // Validate credentials with real SumUp API
      const validation = await api.validateCredentials();
      
      if (validation.valid) {
        addLog('✅ SumUp API credentials validated!');
        addLog(`👤 Account: ${validation.profile?.personal_details?.first_name || 'Test Account'}`);
        addLog('🔗 Callback URL: vmstock://sumup-callback');
        setIsInitialized(true);
        
        Alert.alert(
          'Success!', 
          'SumUp API initialized successfully!\n\nYour credentials are valid and connected to SumUp\'s servers.'
        );
      } else {
        throw new Error(validation.error || 'Credential validation failed');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      addLog(`❌ Initialization failed: ${errorMessage}`);
      Alert.alert('Initialization Error', `Failed to connect to SumUp API:\n\n${errorMessage}`);
    }
  };

  // Process a test payment
  const processTestPayment = async (amount: number, description: string) => {
    if (!isInitialized || !sumUpAPI) {
      Alert.alert('Not Ready', 'Please initialize SumUp first');
      return;
    }

    setIsProcessing(true);
    addLog(`💳 Starting payment: £${amount} - ${description}`);

    try {
      // Create checkout with real SumUp API
      const paymentResult = await sumUpAPI.processPayment({
        amount: amount,
        currency: 'GBP',
        merchant_code: 'CCCVLMNUE',
        checkout_reference: `vmstock_${Date.now()}`,
        description: description,
        customer_email: 'test@vmstock.com'
      });

      if (paymentResult.success) {
        const successResult: PaymentResult = {
          success: true,
          transactionId: paymentResult.checkout_id,
          amount: amount,
          message: 'Checkout created successfully - Ready for payment',
          paymentMethod: 'SumUp Web API'
        };

        addLog(`✅ Checkout created: ${paymentResult.checkout_id}`);
        addLog(`🔗 Payment URL: ${paymentResult.checkout_url?.substring(0, 50)}...`);
        setLastResult(successResult);
        
        Alert.alert(
          'Checkout Created!', 
          `✅ SumUp checkout created successfully!\n\nCheckout ID: ${paymentResult.checkout_id}\nAmount: £${amount}\n\nIn production, this would open the payment interface.`
        );
      } else {
        throw new Error(paymentResult.error || 'Checkout creation failed');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';
      const failureResult: PaymentResult = {
        success: false,
        message: errorMessage
      };
      
      addLog(`❌ Payment failed: ${errorMessage}`);
      setLastResult(failureResult);
      Alert.alert('Payment Failed', `Failed to create checkout:\n\n${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Test different payment scenarios
  const testScenarios = [
    { amount: 2.50, description: 'Single Item Test' },
    { amount: 7.50, description: 'Multiple Items Test' },
    { amount: 15.00, description: 'Large Order Test' },
    { amount: 0.50, description: 'Small Amount Test' }
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>SumUp Payment Tester</Text>
        <Text style={styles.subtitle}>Android NFC & Card Payment Testing</Text>
        <View style={styles.statusBadge}>
          <Text style={[styles.statusText, { color: isInitialized ? '#4CAF50' : '#FF9800' }]}>
            {isInitialized ? '✅ Ready' : '⏳ Not Initialized'}
          </Text>
        </View>
      </View>

      {/* Initialization Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1. Initialize SumUp SDK</Text>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton, isInitialized && styles.successButton]}
          onPress={initializeSumUp}
          disabled={isInitialized}
        >
          <Text style={styles.buttonText}>
            {isInitialized ? '✅ Initialized' : '🚀 Initialize SumUp'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Test Payments Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. Test Payments</Text>
        <Text style={styles.sectionDescription}>
          Test different payment amounts and scenarios
        </Text>
        
        {testScenarios.map((scenario, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.button,
              styles.testButton,
              !isInitialized && styles.disabledButton
            ]}
            onPress={() => processTestPayment(scenario.amount, scenario.description)}
            disabled={!isInitialized || isProcessing}
          >
            <View style={styles.testButtonContent}>
              <Text style={styles.testButtonTitle}>£{scenario.amount.toFixed(2)}</Text>
              <Text style={styles.testButtonDescription}>{scenario.description}</Text>
            </View>
            {isProcessing && (
              <ActivityIndicator color="#007AFF" size="small" />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Last Result Section */}
      {lastResult && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last Payment Result</Text>
          <View style={[
            styles.resultCard,
            { backgroundColor: lastResult.success ? '#E8F5E8' : '#FFE8E8' }
          ]}>
            <Text style={[
              styles.resultStatus,
              { color: lastResult.success ? '#4CAF50' : '#F44336' }
            ]}>
              {lastResult.success ? '✅ SUCCESS' : '❌ FAILED'}
            </Text>
            <Text style={styles.resultMessage}>{lastResult.message}</Text>
            {lastResult.transactionId && (
              <Text style={styles.resultDetail}>ID: {lastResult.transactionId}</Text>
            )}
            {lastResult.amount && (
              <Text style={styles.resultDetail}>Amount: £{lastResult.amount}</Text>
            )}
            {lastResult.paymentMethod && (
              <Text style={styles.resultDetail}>Method: {lastResult.paymentMethod}</Text>
            )}
          </View>
        </View>
      )}

      {/* Logs Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activity Log</Text>
        <View style={styles.logContainer}>
          {initializationLog.map((log, index) => (
            <Text key={index} style={styles.logEntry}>{log}</Text>
          ))}
          {initializationLog.length === 0 && (
            <Text style={styles.logPlaceholder}>No activity yet...</Text>
          )}
        </View>
      </View>

      {/* Instructions Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Instructions</Text>
        <View style={styles.instructionsContainer}>
          <Text style={styles.instruction}>1. Initialize SumUp first</Text>
          <Text style={styles.instruction}>2. Test with small amounts in sandbox mode</Text>
          <Text style={styles.instruction}>3. Use test cards for NFC testing</Text>
          <Text style={styles.instruction}>4. Check logs for detailed information</Text>
          <Text style={styles.warningText}>
            ✅ Using real SumUp Web API with your test credentials.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#007AFF',
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#E3F2FD',
    marginBottom: 12,
  },
  statusBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    backgroundColor: 'white',
    margin: 12,
    padding: 16,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  button: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
  },
  successButton: {
    backgroundColor: '#4CAF50',
  },
  testButton: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E1E5E9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#F0F0F0',
    borderColor: '#D0D0D0',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  testButtonContent: {
    flex: 1,
  },
  testButtonTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  testButtonDescription: {
    fontSize: 14,
    color: '#666',
  },
  resultCard: {
    padding: 16,
    borderRadius: 8,
    marginTop: 8,
  },
  resultStatus: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  resultMessage: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
  },
  resultDetail: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  logContainer: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
    maxHeight: 200,
  },
  logEntry: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#333',
    marginBottom: 4,
  },
  logPlaceholder: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 20,
  },
  instructionsContainer: {
    marginTop: 8,
  },
  instruction: {
    fontSize: 14,
    color: '#333',
    marginBottom: 6,
    paddingLeft: 8,
  },
  warningText: {
    fontSize: 12,
    color: '#FF9800',
    marginTop: 8,
    fontStyle: 'italic',
  },
});