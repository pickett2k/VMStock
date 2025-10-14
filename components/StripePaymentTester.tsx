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
import { stripePaymentService, StripePaymentResult } from '../services/StripePaymentService';

interface TestResult {
  test: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
  duration?: number;
}

export default function StripePaymentTester() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<StripePaymentResult | null>(null);
  const [initializationLog, setInitializationLog] = useState<string[]>([]);
  const [deviceCapable, setDeviceCapable] = useState<boolean | null>(null);

  const addLog = (message: string) => {
    setInitializationLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    console.log(`Stripe: ${message}`);
  };

  // Initialize Stripe
  const initializeStripe = async () => {
    try {
      addLog('Starting Stripe initialization...');
      
      // Check configuration
      const status = stripePaymentService.getInitializationStatus();
      addLog(`Environment: ${status.environment}`);
      addLog(`Publishable Key: ${status.hasPublishableKey ? '✅ Configured' : '❌ Missing'}`);
      addLog(`Secret Key: ${status.hasSecretKey ? '✅ Configured' : '❌ Missing'}`);

      if (!status.hasPublishableKey || !status.hasSecretKey) {
        throw new Error('Stripe keys not configured. Please add them to your .env file.');
      }

      // Initialize Stripe SDK
      await stripePaymentService.initialize();
      
      // Check device capabilities
      const isCapable = await stripePaymentService.isDeviceCapable();
      setDeviceCapable(isCapable);
      
      addLog(`Device Tap to Pay: ${isCapable ? '✅ Supported' : '❌ Not Supported'}`);
      addLog('✅ Stripe initialized successfully!');
      addLog('🔗 Callback URL: vmstock://stripe-callback');
      
      setIsInitialized(true);
      
      Alert.alert(
        'Success!', 
        `Stripe initialized successfully!\n\n` +
        `Environment: ${status.environment.toUpperCase()}\n` +
        `Tap to Pay: ${isCapable ? 'Supported' : 'Not Supported'}\n\n` +
        `Ready for testing!`
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      addLog(`❌ Initialization failed: ${errorMessage}`);
      Alert.alert('Initialization Error', errorMessage);
    }
  };

  // Process different payment types
  const processPayment = async (amount: number, description: string, method: 'tap' | 'reader' | 'manual') => {
    if (!isInitialized) {
      Alert.alert('Not Ready', 'Please initialize Stripe first');
      return;
    }

    setIsProcessing(true);
    addLog(`💳 Starting ${method} payment: £${(amount / 100).toFixed(2)} - ${description}`);

    try {
      const paymentRequest = {
        amount: amount, // Stripe uses cents
        currency: 'gbp',
        description: description,
        receiptEmail: 'test@vmstock.com',
        metadata: {
          player: 'Curtis Hypolite',
          products: description,
          app: 'VMStock'
        }
      };

      let result: StripePaymentResult;

      switch (method) {
        case 'tap':
          addLog('📱 Starting NFC Tap to Pay...');
          addLog('👆 Please tap card or mobile device');
          result = await stripePaymentService.processTapToPay(paymentRequest);
          break;
        case 'reader':
          addLog('🔌 Starting Card Reader...');
          addLog('💳 Please insert, swipe, or tap card on reader');
          result = await stripePaymentService.processCardReader(paymentRequest);
          break;
        case 'manual':
          addLog('✏️ Starting Manual Entry...');
          addLog('⌨️ Card details would be entered manually');
          result = await stripePaymentService.processManualEntry(paymentRequest);
          break;
      }

      setLastResult(result);

      if (result.success) {
        addLog(`✅ Payment successful: ${result.paymentIntentId}`);
        Alert.alert(
          'Payment Success!', 
          `✅ Payment completed successfully!\n\n` +
          `Payment ID: ${result.paymentIntentId}\n` +
          `Amount: £${(result.amount! / 100).toFixed(2)}\n` +
          `Method: ${result.paymentMethod}\n\n` +
          `Receipt: ${result.receiptUrl ? 'Available' : 'Not available'}`
        );
      } else {
        addLog(`❌ Payment failed: ${result.error}`);
        Alert.alert('Payment Failed', result.error || 'Unknown error occurred');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';
      addLog(`❌ Payment error: ${errorMessage}`);
      Alert.alert('Payment Error', errorMessage);
      
      setLastResult({
        success: false,
        amount: amount,
        currency: 'gbp',
        error: errorMessage
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Test scenarios with realistic amounts
  const testScenarios = [
    { amount: 250, description: 'Single Item (Madri Can)', method: 'tap' as const },
    { amount: 750, description: 'Multiple Items (3x Madri)', method: 'tap' as const },
    { amount: 1500, description: 'Large Order (Mixed Items)', method: 'reader' as const },
    { amount: 50, description: 'Small Purchase (Sweets)', method: 'manual' as const }
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Stripe Payment Tester</Text>
        <Text style={styles.subtitle}>NFC Tap to Pay & Card Processing</Text>
        <View style={styles.statusRow}>
          <View style={styles.statusBadge}>
            <Text style={[styles.statusText, { color: isInitialized ? '#4CAF50' : '#FF9800' }]}>
              {isInitialized ? '✅ Ready' : '⏳ Not Initialized'}
            </Text>
          </View>
          {deviceCapable !== null && (
            <View style={[styles.statusBadge, { marginLeft: 8 }]}>
              <Text style={[styles.statusText, { color: deviceCapable ? '#4CAF50' : '#FF5722' }]}>
                {deviceCapable ? '📱 NFC Ready' : '📱 NFC Limited'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Initialization Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1. Initialize Stripe</Text>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton, isInitialized && styles.successButton]}
          onPress={initializeStripe}
          disabled={isInitialized}
        >
          <Text style={styles.buttonText}>
            {isInitialized ? '✅ Initialized' : '🚀 Initialize Stripe'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Test Payments Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. Test Payments</Text>
        <Text style={styles.sectionDescription}>
          Test different payment methods and amounts
        </Text>
        
        {testScenarios.map((scenario, index) => {
          const methodIcon = scenario.method === 'tap' ? '📱' : scenario.method === 'reader' ? '💳' : '✏️';
          const methodName = scenario.method === 'tap' ? 'Tap to Pay' : scenario.method === 'reader' ? 'Card Reader' : 'Manual Entry';
          
          return (
            <TouchableOpacity
              key={index}
              style={[
                styles.button,
                styles.testButton,
                !isInitialized && styles.disabledButton
              ]}
              onPress={() => processPayment(scenario.amount, scenario.description, scenario.method)}
              disabled={!isInitialized || isProcessing}
            >
              <View style={styles.testButtonContent}>
                <View style={styles.testButtonHeader}>
                  <Text style={styles.testButtonTitle}>£{(scenario.amount / 100).toFixed(2)}</Text>
                  <Text style={styles.testButtonMethod}>{methodIcon} {methodName}</Text>
                </View>
                <Text style={styles.testButtonDescription}>{scenario.description}</Text>
              </View>
              {isProcessing && (
                <ActivityIndicator color="#007AFF" size="small" />
              )}
            </TouchableOpacity>
          );
        })}
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
            <Text style={styles.resultMessage}>
              {lastResult.success ? 'Payment completed successfully' : lastResult.error}
            </Text>
            {lastResult.paymentIntentId && (
              <Text style={styles.resultDetail}>ID: {lastResult.paymentIntentId}</Text>
            )}
            {lastResult.amount && (
              <Text style={styles.resultDetail}>Amount: £{(lastResult.amount / 100).toFixed(2)}</Text>
            )}
            {lastResult.paymentMethod && (
              <Text style={styles.resultDetail}>Method: {lastResult.paymentMethod}</Text>
            )}
            {lastResult.receiptUrl && (
              <Text style={styles.resultDetail}>Receipt: Available in Stripe Dashboard</Text>
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
        <Text style={styles.sectionTitle}>Setup Instructions</Text>
        <View style={styles.instructionsContainer}>
          <Text style={styles.instruction}>1. Create Stripe account at stripe.com</Text>
          <Text style={styles.instruction}>2. Get API keys from Dashboard → Developers</Text>
          <Text style={styles.instruction}>3. Add keys to .env file:</Text>
          <Text style={styles.codeText}>   STRIPE_PUBLISHABLE_KEY=pk_test_...</Text>
          <Text style={styles.codeText}>   STRIPE_SECRET_KEY=sk_test_...</Text>
          <Text style={styles.instruction}>4. Install Stripe SDK:</Text>
          <Text style={styles.codeText}>   npm install @stripe/stripe-react-native</Text>
          <Text style={styles.warningText}>
            ⚠️ Currently using mock responses. Install Stripe SDK for real testing.
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
    backgroundColor: '#635BFF', // Stripe brand color
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
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  statusBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 12,
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
    backgroundColor: '#635BFF',
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
  testButtonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  testButtonTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#635BFF',
  },
  testButtonMethod: {
    fontSize: 12,
    color: '#666',
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
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
  codeText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#666',
    backgroundColor: '#F5F5F5',
    padding: 8,
    marginBottom: 4,
    borderRadius: 4,
  },
  warningText: {
    fontSize: 12,
    color: '#FF9800',
    marginTop: 8,
    fontStyle: 'italic',
  },
});