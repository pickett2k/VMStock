import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';

// Mock SumUp SDK for testing without physical device
const mockSumUpSDK = {
  initialize: async (config: any) => {
    // Simulate initialization delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('🔧 Mock SumUp SDK initialized with config:', config);
    return { success: true, message: 'Initialized successfully' };
  },

  processPayment: async (amount: number, currency: string = 'GBP') => {
    // Simulate payment processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate different outcomes based on amount
    if (amount < 1) {
      throw new Error('Amount too small');
    }
    
    if (amount > 100) {
      throw new Error('Amount too large for test');
    }
    
    // 90% success rate for testing
    if (Math.random() > 0.9) {
      throw new Error('Card declined');
    }
    
    return {
      transactionId: `txn_test_${Date.now()}`,
      status: 'SUCCESSFUL',
      amount,
      currency,
      paymentMethod: 'NFC',
      cardType: 'VISA',
      lastFourDigits: '1234',
      timestamp: new Date().toISOString(),
    };
  },

  isNFCEnabled: async () => {
    // Mock NFC availability check
    return true;
  },
};

interface TestResult {
  test: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
  duration?: number;
}

export default function SumUpTestComponent() {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const updateTestResult = (testName: string, status: TestResult['status'], message?: string, startTime?: number) => {
    const duration = startTime ? Date.now() - startTime : undefined;
    setTestResults(prev => {
      const existingIndex = prev.findIndex(r => r.test === testName);
      const newResult: TestResult = { test: testName, status, message, duration };
      
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = newResult;
        return updated;
      } else {
        return [...prev, newResult];
      }
    });
  };

  const runConfigurationTest = async () => {
    const testName = 'Configuration Validation';
    const startTime = Date.now();
    updateTestResult(testName, 'pending');
    
    try {
      // Check environment variables (in a real app, use react-native-config)
      const requiredVars = ['SUMUP_APP_ID', 'SUMUP_MERCHANT_CODE', 'SUMUP_ENVIRONMENT'];
      const missingVars = requiredVars.filter(v => !process.env[v]);
      
      if (missingVars.length > 0) {
        throw new Error(`Missing: ${missingVars.join(', ')}`);
      }
      
      updateTestResult(testName, 'success', 'All required configuration present', startTime);
    } catch (error) {
      updateTestResult(testName, 'error', error instanceof Error ? error.message : 'Unknown error', startTime);
    }
  };

  const runInitializationTest = async () => {
    const testName = 'SDK Initialization';
    const startTime = Date.now();
    updateTestResult(testName, 'pending');
    
    try {
      const config = {
        appId: 'cc_classic_YOGFj1PqeOOf83P2pCDHfcoeBK8mn',
        merchantCode: 'CCCVLMNUE',
        environment: 'sandbox'
      };
      
      const result = await mockSumUpSDK.initialize(config);
      updateTestResult(testName, 'success', result.message, startTime);
    } catch (error) {
      updateTestResult(testName, 'error', error instanceof Error ? error.message : 'Unknown error', startTime);
    }
  };

  const runNFCTest = async () => {
    const testName = 'NFC Availability';
    const startTime = Date.now();
    updateTestResult(testName, 'pending');
    
    try {
      const isAvailable = await mockSumUpSDK.isNFCEnabled();
      updateTestResult(testName, 'success', `NFC ${isAvailable ? 'Available' : 'Not Available'}`, startTime);
    } catch (error) {
      updateTestResult(testName, 'error', error instanceof Error ? error.message : 'Unknown error', startTime);
    }
  };

  const runPaymentTest = async (amount: number, description: string) => {
    const testName = `Payment Test (£${amount})`;
    const startTime = Date.now();
    updateTestResult(testName, 'pending');
    
    try {
      const result = await mockSumUpSDK.processPayment(amount, 'GBP');
      updateTestResult(
        testName, 
        'success', 
        `${result.paymentMethod} - ${result.cardType} ****${result.lastFourDigits}`, 
        startTime
      );
    } catch (error) {
      updateTestResult(testName, 'error', error instanceof Error ? error.message : 'Unknown error', startTime);
    }
  };

  const runAllTests = async () => {
    setIsRunning(true);
    setTestResults([]);
    
    try {
      await runConfigurationTest();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await runInitializationTest();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await runNFCTest();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Test different payment amounts
      await runPaymentTest(2.50, 'Single item');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await runPaymentTest(7.50, 'Multiple items');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await runPaymentTest(15.75, 'Large order');
      
      Alert.alert('Tests Complete', 'All SumUp integration tests have finished running.');
    } catch (error) {
      Alert.alert('Test Error', error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '⚪';
    }
  };

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'pending': return '#FFA500';
      case 'success': return '#4CAF50';
      case 'error': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SumUp Integration Test Suite</Text>
      <Text style={styles.subtitle}>Test NFC payments without physical device</Text>
      
      <TouchableOpacity
        style={[styles.runButton, isRunning && styles.runButtonDisabled]}
        onPress={runAllTests}
        disabled={isRunning}
      >
        <Text style={styles.runButtonText}>
          {isRunning ? '🧪 Running Tests...' : '🚀 Run All Tests'}
        </Text>
      </TouchableOpacity>
      
      <ScrollView style={styles.resultsContainer}>
        {testResults.map((result, index) => (
          <View key={index} style={styles.testResult}>
            <View style={styles.testHeader}>
              <Text style={styles.testIcon}>{getStatusIcon(result.status)}</Text>
              <Text style={styles.testName}>{result.test}</Text>
              {result.duration && (
                <Text style={styles.testDuration}>{result.duration}ms</Text>
              )}
            </View>
            {result.message && (
              <Text style={[styles.testMessage, { color: getStatusColor(result.status) }]}>
                {result.message}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
      
      {testResults.length > 0 && (
        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            ✅ {testResults.filter(r => r.status === 'success').length} passed • 
            ❌ {testResults.filter(r => r.status === 'error').length} failed • 
            ⏳ {testResults.filter(r => r.status === 'pending').length} running
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    color: '#666',
  },
  runButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  runButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  runButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  resultsContainer: {
    flex: 1,
  },
  testResult: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  testHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  testIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  testName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    color: '#333',
  },
  testDuration: {
    fontSize: 12,
    color: '#999',
  },
  testMessage: {
    fontSize: 14,
    marginTop: 8,
    marginLeft: 32,
  },
  summary: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginTop: 12,
  },
  summaryText: {
    fontSize: 14,
    textAlign: 'center',
    color: '#666',
  },
});