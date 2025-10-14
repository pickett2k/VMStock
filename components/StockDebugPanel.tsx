/**
 * 🔧 Stock Debug Panel
 * 
 * Advanced debugging interface for stock operations and synchronization issues.
 * Provides tools for analyzing, debugging, and fixing stock-related problems.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { StockReconciliationTool, ReconciliationReport } from '../utils/StockReconciliationTool';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface StockDebugPanelProps {
  visible: boolean;
  onClose: () => void;
}

export const StockDebugPanel: React.FC<StockDebugPanelProps> = ({ visible, onClose }) => {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [debugData, setDebugData] = useState<any>(null);

  const reconciliationTool = new StockReconciliationTool();

  /**
   * 🔍 Run full stock analysis
   */
  const runStockAnalysis = async () => {
    setLoading(true);
    try {
      const analysisReport = await reconciliationTool.analyzeStockIssues();
      setReport(analysisReport);
      
      Alert.alert(
        '📊 Analysis Complete',
        `Found ${analysisReport.totalIssues} stock issues:\n` +
        `• ${analysisReport.negativeStockProducts.length} negative stock products\n` +
        `• ${analysisReport.duplicateOperationsFound} duplicate operations\n` +
        `• ${analysisReport.recommendedFixes.length} recommended fixes`
      );
    } catch (error) {
      Alert.alert('❌ Analysis Failed', String(error));
    } finally {
      setLoading(false);
    }
  };

  /**
   * � Run advanced historical duplicate analysis
   */
  const runAdvancedAnalysis = async () => {
    setLoading(true);
    try {
      const duplicateAnalysis = await reconciliationTool.analyzeAssignmentDuplicates();
      
      Alert.alert(
        '🔬 Historical Duplicate Analysis',
        `Found ${duplicateAnalysis.suspiciousAssignments.length} products with suspicious patterns:\n` +
        `Total suspicious stock: ${duplicateAnalysis.totalSuspiciousStock}\n\n` +
        'Check console logs for detailed analysis.'
      );
    } catch (error) {
      Alert.alert('❌ Analysis Failed', String(error));
    } finally {
      setLoading(false);
    }
  };

  /**
   * �🔧 Apply all recommended fixes
   */
  const applyFixes = async () => {
    if (!report || report.recommendedFixes.length === 0) {
      Alert.alert('⚠️ No Fixes', 'No fixes available to apply.');
      return;
    }

    Alert.alert(
      '🔧 Apply Fixes?',
      `This will apply ${report.recommendedFixes.length} fixes to resolve stock issues. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply Fixes',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await reconciliationTool.applyFixes(report.recommendedFixes);
              Alert.alert('✅ Fixes Applied', 'Stock issues have been resolved.');
              
              // Re-run analysis to see results
              await new Promise(resolve => setTimeout(resolve, 1000));
              await runStockAnalysis();
            } catch (error) {
              Alert.alert('❌ Fix Failed', String(error));
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  /**
   * 🧹 Clean up duplicate operations
   */
  const cleanupDuplicates = async () => {
    Alert.alert(
      '🧹 Cleanup Duplicates?',
      'This will remove duplicate operations from provisional storage. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Cleanup',
          onPress: async () => {
            setLoading(true);
            try {
              const cleanedCount = await reconciliationTool.cleanupDuplicateOperations();
              Alert.alert('✅ Cleanup Complete', `Removed ${cleanedCount} duplicate operations.`);
            } catch (error) {
              Alert.alert('❌ Cleanup Failed', String(error));
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  /**
   * 📊 Load debug data
   */
  const loadDebugData = async () => {
    setLoading(true);
    try {
      const data = {
        provisionalStockDeltas: await AsyncStorage.getItem('provisional_stock_deltas'),
        provisionalBalanceDeltas: await AsyncStorage.getItem('provisional_balance_deltas'),
        provisionalSteps: await AsyncStorage.getItem('provisional_steps'),
        cacheProducts: await AsyncStorage.getItem('cache_products'),
        cachePlayers: await AsyncStorage.getItem('cache_players'),
      };

      const parsedData = {
        provisionalStockDeltas: data.provisionalStockDeltas ? JSON.parse(data.provisionalStockDeltas) : null,
        provisionalBalanceDeltas: data.provisionalBalanceDeltas ? JSON.parse(data.provisionalBalanceDeltas) : null,
        provisionalSteps: data.provisionalSteps ? JSON.parse(data.provisionalSteps) : null,
        cacheProducts: data.cacheProducts ? JSON.parse(data.cacheProducts) : null,
        cachePlayers: data.cachePlayers ? JSON.parse(data.cachePlayers) : null,
      };

      setDebugData(parsedData);
    } catch (error) {
      Alert.alert('❌ Debug Load Failed', String(error));
    } finally {
      setLoading(false);
    }
  };

  /**
   * 🗑️ Clear all caches
   */
  const clearAllCaches = async () => {
    Alert.alert(
      '🗑️ Clear All Caches?',
      'This will clear all cached data and provisional operations. This action cannot be undone!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const keys = [
                'provisional_stock_deltas',
                'provisional_balance_deltas',
                'provisional_steps',
                'provisional_assignment_updates',
                'cache_products',
                'cache_players',
                'cache_assignments',
                'cache_charges',
              ];

              await AsyncStorage.multiRemove(keys);
              Alert.alert('✅ Caches Cleared', 'All cached data has been cleared.');
              setReport(null);
              setDebugData(null);
            } catch (error) {
              Alert.alert('❌ Clear Failed', String(error));
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🔧 Stock Debug Panel</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Processing...</Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🔧 Stock Tools</Text>
            
            <TouchableOpacity style={styles.button} onPress={runStockAnalysis} disabled={loading}>
              <Text style={styles.buttonText}>🔍 Analyze Stock Issues</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.diagnosticButton]} onPress={runAdvancedAnalysis} disabled={loading}>
              <Text style={styles.buttonText}>🔬 Analyze Historical Duplicates</Text>
            </TouchableOpacity>

            {report && report.recommendedFixes.length > 0 && (
              <TouchableOpacity style={[styles.button, styles.warningButton]} onPress={applyFixes} disabled={loading}>
                <Text style={styles.buttonText}>🔧 Apply {report.recommendedFixes.length} Fixes</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.button} onPress={cleanupDuplicates} disabled={loading}>
              <Text style={styles.buttonText}>🧹 Cleanup Duplicates</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.button} onPress={loadDebugData} disabled={loading}>
              <Text style={styles.buttonText}>📊 Load Debug Data</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={clearAllCaches} disabled={loading}>
              <Text style={styles.buttonText}>🗑️ Clear All Caches</Text>
            </TouchableOpacity>
          </View>

          {/* Analysis Report */}
          {report && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📊 Analysis Report</Text>
              
              <View style={styles.reportCard}>
                <Text style={styles.reportTitle}>Summary</Text>
                <Text style={styles.reportText}>Total Issues: {report.totalIssues}</Text>
                <Text style={styles.reportText}>Negative Stock Products: {report.negativeStockProducts.length}</Text>
                <Text style={styles.reportText}>Duplicate Operations: {report.duplicateOperationsFound}</Text>
                <Text style={styles.reportText}>Recommended Fixes: {report.recommendedFixes.length}</Text>
              </View>

              {report.negativeStockProducts.map((issue, index) => (
                <View key={index} style={styles.issueCard}>
                  <Text style={styles.issueTitle}>❌ {issue.productName}</Text>
                  <Text style={styles.issueText}>Current Stock: {issue.currentStock}</Text>
                  <Text style={styles.issueText}>Expected Stock: {issue.expectedStock}</Text>
                  <Text style={styles.issueText}>Discrepancy: {issue.stockDiscrepancy}</Text>
                  <Text style={styles.issueText}>Duplicates: {issue.duplicateOperations.length}</Text>
                </View>
              ))}

              {report.recommendedFixes.length > 0 && (
                <View style={styles.reportCard}>
                  <Text style={styles.reportTitle}>💡 Recommended Fixes</Text>
                  {report.recommendedFixes.map((fix, index) => (
                    <Text key={index} style={styles.reportText}>
                      • {fix.action}: {fix.reason}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Debug Data */}
          {debugData && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🐛 Debug Data</Text>
              
              {Object.entries(debugData).map(([key, value]) => (
                <View key={key} style={styles.debugCard}>
                  <Text style={styles.debugTitle}>{key}</Text>
                  <Text style={styles.debugText} numberOfLines={10}>
                    {value ? JSON.stringify(value, null, 2) : 'null'}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  warningButton: {
    backgroundColor: '#FF9500',
  },
  diagnosticButton: {
    backgroundColor: '#6366F1',
  },
  dangerButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  reportCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  reportTitle: {
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 8,
    color: '#333',
  },
  reportText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  issueCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#FF3B30',
  },
  issueTitle: {
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 8,
    color: '#FF3B30',
  },
  issueText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  debugCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#666',
  },
  debugTitle: {
    fontWeight: 'bold',
    fontSize: 12,
    marginBottom: 8,
    color: '#333',
  },
  debugText: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
  },
});