/**
 * 🔧 Stock Reconciliation Tool
 * 
 * Detects and fixes negative stock issues caused by duplicate operations
 * during multi-user offline sync scenarios.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { hybridSyncService, HybridSyncService } from '../services/HybridSyncService';

export interface StockIssue {
  productId: string;
  productName: string;
  currentStock: number;
  expectedStock: number;
  stockDiscrepancy: number;
  duplicateOperations: Array<{
    opId: string;
    delta: number;
    timestamp: number;
    source: 'provisional' | 'base';
  }>;
}

export interface ReconciliationReport {
  totalIssues: number;
  negativeStockProducts: StockIssue[];
  duplicateOperationsFound: number;
  recommendedFixes: Array<{
    productId: string;
    action: 'setMinimumStock' | 'removeOperation' | 'adjustDelta';
    value: number;
    reason: string;
  }>;
}

export class StockReconciliationTool {
  private hybridSync: HybridSyncService;

  constructor() {
    this.hybridSync = hybridSyncService;
  }

  /**
   * 🔍 Analyze all products for stock inconsistencies
   */
  async analyzeStockIssues(): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      totalIssues: 0,
      negativeStockProducts: [],
      duplicateOperationsFound: 0,
      recommendedFixes: []
    };

    try {
      // Get all products with stock
      const products = await this.hybridSync.getProducts();
      
      for (const product of products) {
        if (typeof product.stock === 'number' && product.stock < 0) {
          const issue = await this.analyzeProductStock(product);
          if (issue) {
            report.negativeStockProducts.push(issue);
            report.totalIssues++;
            report.duplicateOperationsFound += issue.duplicateOperations.length;

            // Generate fix recommendation
            const fix = this.generateFixRecommendation(issue);
            if (fix) {
              report.recommendedFixes.push(fix);
            }
          }
        }
      }

      // 🔍 DIAGNOSTIC: Log detailed analysis for root cause investigation
      if (report.negativeStockProducts.length > 0) {
        console.log('🚨 ROOT CAUSE ANALYSIS:');
        for (const issue of report.negativeStockProducts) {
          console.log(`📊 Product: ${issue.productName}`);
          console.log(`   Current Stock: ${issue.currentStock}`);
          console.log(`   Expected Stock: ${issue.expectedStock}`);
          console.log(`   Discrepancy: ${issue.stockDiscrepancy}`);
          console.log(`   Provisional Duplicates: ${issue.duplicateOperations.length}`);
          
          // Hypothesis: If current stock is much more negative than expected, 
          // it suggests historical duplicate applications
          if (issue.currentStock < 0 && Math.abs(issue.currentStock) > Math.abs(issue.expectedStock) * 2) {
            console.log('   🎯 LIKELY CAUSE: Historical duplicate operations (already committed to base)');
          }
        }
      }

      console.log('📊 Stock Reconciliation Report:', report);
      return report;

    } catch (error) {
      console.error('❌ Failed to analyze stock issues:', error);
      throw error;
    }
  }

  /**
   * 🔍 Deep analysis of a specific product's stock history
   */
  private async analyzeProductStock(product: any): Promise<StockIssue | null> {
    try {
      const productId = product.productId || product.id;
      
      // Get provisional stock deltas
      const provisionalDeltas = await this.getProvisionalStockDeltas(productId);
      
      // Get base stock (if any historical data exists)
      const baseStock = await this.getBaseStock(productId);
      
      // Calculate expected stock based on operations
      let calculatedStock = baseStock || 0;
      const allOperations: Array<{
        opId: string;
        delta: number;
        timestamp: number;
        source: 'provisional' | 'base';
      }> = [];

      // Track duplicate opIds
      const seenOpIds = new Set<string>();
      const duplicates: typeof allOperations = [];

      // Process provisional deltas
      for (const delta of provisionalDeltas) {
        if (seenOpIds.has(delta.opId)) {
          duplicates.push({ ...delta, source: 'provisional' });
        } else {
          seenOpIds.add(delta.opId);
          calculatedStock += delta.delta;
        }
        allOperations.push({ ...delta, source: 'provisional' });
      }

      // 🔍 ENHANCED: Check if negative stock suggests historical duplicates
      const isNegative = product.stock < 0;
      const hasProvisionalIssues = duplicates.length > 0;
      const hasDiscrepancy = product.stock !== calculatedStock;
      
      // Create issue for ANY concerning situation
      if (isNegative || hasProvisionalIssues || hasDiscrepancy) {
        return {
          productId: productId,
          productName: product.name || 'Unknown Product',
          currentStock: product.stock,
          expectedStock: calculatedStock,
          stockDiscrepancy: product.stock - calculatedStock,
          duplicateOperations: duplicates
        };
      }

      return null;

    } catch (error) {
      console.error(`❌ Failed to analyze product ${product.productId || product.id}:`, error);
      return null;
    }
  }

  /**
   * 📋 Get provisional stock deltas for a product
   */
  private async getProvisionalStockDeltas(productId: string): Promise<Array<{
    opId: string;
    delta: number;
    timestamp: number;
  }>> {
    try {
      const rawData = await AsyncStorage.getItem('provisional_stock_deltas');
      const data = rawData ? JSON.parse(rawData) : {};
      return data[productId] || [];
    } catch (error) {
      console.error('❌ Failed to get provisional stock deltas:', error);
      return [];
    }
  }

  /**
   * 📊 Get base stock (from base cache)
   */
  private async getBaseStock(productId: string): Promise<number> {
    try {
      const rawData = await AsyncStorage.getItem('products'); // Use 'products' key consistently
      const data = rawData ? JSON.parse(rawData) : [];
      
      // Ensure data is an array
      if (!Array.isArray(data)) {
        console.warn('⚠️ Products cache is not an array:', typeof data);
        return 0;
      }
      
      const product = data.find((p: any) => p.productId === productId || p.id === productId);
      return product?.stock || 0;
    } catch (error) {
      console.error('❌ Failed to get base stock:', error);
      return 0;
    }
  }

  /**
   * 💡 Generate fix recommendation for a stock issue
   */
  private generateFixRecommendation(issue: StockIssue): any {
    if (issue.duplicateOperations.length > 0) {
      // Most likely cause: duplicate operations
      const totalDuplicateDelta = issue.duplicateOperations.reduce(
        (sum, op) => sum + op.delta, 0
      );
      
      return {
        productId: issue.productId,
        action: 'adjustDelta' as const,
        value: -totalDuplicateDelta, // Reverse the duplicates
        reason: `Remove ${issue.duplicateOperations.length} duplicate operations (total delta: ${totalDuplicateDelta})`
      };
    }

    if (issue.currentStock < 0) {
      // 🔍 ENHANCED: Check if this looks like historical duplicate damage
      const likelyHistoricalDuplicate = Math.abs(issue.currentStock) > Math.abs(issue.expectedStock) && issue.expectedStock >= 0;
      
      if (likelyHistoricalDuplicate) {
        return {
          productId: issue.productId,
          action: 'setMinimumStock' as const,
          value: Math.max(0, issue.expectedStock), // Use expected stock if positive
          reason: `Reset negative stock (${issue.currentStock}) - likely historical duplicate issue. Expected: ${issue.expectedStock}`
        };
      } else {
        return {
          productId: issue.productId,
          action: 'setMinimumStock' as const,
          value: 0,
          reason: `Reset negative stock (${issue.currentStock}) to safe minimum (0)`
        };
      }
    }

    // Handle discrepancies without negative stock
    if (issue.stockDiscrepancy !== 0) {
      return {
        productId: issue.productId,
        action: 'adjustDelta' as const,
        value: -issue.stockDiscrepancy, // Adjust to expected
        reason: `Correct stock discrepancy: current=${issue.currentStock}, expected=${issue.expectedStock}`
      };
    }

    return null;
  }

  /**
   * 🔧 Apply recommended fixes
   */
  async applyFixes(fixes: ReconciliationReport['recommendedFixes']): Promise<void> {
    console.log(`🔧 Applying ${fixes.length} stock fixes...`);

    for (const fix of fixes) {
      try {
        switch (fix.action) {
          case 'setMinimumStock':
            await this.setProductStock(fix.productId, fix.value);
            console.log(`✅ Set ${fix.productId} stock to ${fix.value}: ${fix.reason}`);
            break;

          case 'adjustDelta':
            await this.adjustProductStock(fix.productId, fix.value);
            console.log(`✅ Adjusted ${fix.productId} stock by ${fix.value}: ${fix.reason}`);
            break;

          case 'removeOperation':
            // This would require more complex operation removal
            console.log(`⚠️ Manual intervention needed for ${fix.productId}: ${fix.reason}`);
            break;
        }
      } catch (error) {
        console.error(`❌ Failed to apply fix for ${fix.productId}:`, error);
      }
    }

    console.log('✅ Stock reconciliation fixes applied');
  }

  /**
   * 🔧 Set product stock directly
   */
  private async setProductStock(productId: string, newStock: number): Promise<void> {
    // Update the product directly via HybridSync
    await this.hybridSync.updateProduct(productId, { stock: newStock });
  }

  /**
   * 🔧 Adjust product stock by delta
   */
  private async adjustProductStock(productId: string, delta: number): Promise<void> {
    const products = await this.hybridSync.getProducts();
    const product = products.find((p: any) => p.productId === productId || p.id === productId);
    
    if (product) {
      const newStock = (product.stock || 0) + delta;
      await this.hybridSync.updateProduct(productId, { stock: Math.max(0, newStock) });
    }
  }

  /**
   * 🔍 ADVANCED: Detect historical duplicates by analyzing assignment patterns
   */
  async analyzeAssignmentDuplicates(): Promise<{
    suspiciousAssignments: Array<{
      productId: string;
      productName: string;
      duplicateAssignments: Array<{
        assignmentId: string;
        playerId: string;
        quantity: number;
        total: number;
        date: string;
      }>;
    }>;
    totalSuspiciousStock: number;
  }> {
    try {
      const assignments = await this.hybridSync.getAssignments();
      const products = await this.hybridSync.getProducts();
      
      // Group assignments by product, player, quantity, and date (potential duplicates)
      const groupedAssignments: Map<string, any[]> = new Map();
      
      for (const assignment of assignments) {
        // Create a key that would identify potential duplicates
        const key = `${assignment.productId}-${assignment.playerId}-${assignment.quantity}-${assignment.date?.split('T')[0]}`;
        
        if (!groupedAssignments.has(key)) {
          groupedAssignments.set(key, []);
        }
        groupedAssignments.get(key)!.push(assignment);
      }
      
      const suspiciousAssignments = [];
      let totalSuspiciousStock = 0;
      
      // Find groups with multiple assignments (potential duplicates)
      for (const [key, assignmentGroup] of groupedAssignments) {
        if (assignmentGroup.length > 1) {
          const [productId] = key.split('-');
          const product = products.find((p: any) => (p.id || p.productId) === productId);
          
          if (product) {
            const totalDuplicateQuantity = assignmentGroup.reduce((sum, a) => sum + a.quantity, 0) - assignmentGroup[0].quantity;
            totalSuspiciousStock += totalDuplicateQuantity;
            
            suspiciousAssignments.push({
              productId,
              productName: product.name,
              duplicateAssignments: assignmentGroup.map(a => ({
                assignmentId: a.id,
                playerId: a.playerId,
                quantity: a.quantity,
                total: a.total,
                date: a.date
              }))
            });
          }
        }
      }
      
      console.log('🔍 Historical Duplicate Analysis:');
      console.log(`   Found ${suspiciousAssignments.length} products with suspicious assignment patterns`);
      console.log(`   Total suspicious stock deductions: ${totalSuspiciousStock}`);
      
      return {
        suspiciousAssignments,
        totalSuspiciousStock
      };
      
    } catch (error) {
      console.error('❌ Failed to analyze assignment duplicates:', error);
      return { suspiciousAssignments: [], totalSuspiciousStock: 0 };
    }
  }

  /**
   * 🧹 Clean up duplicate provisional operations
   */
  async cleanupDuplicateOperations(): Promise<number> {
    let cleanedCount = 0;

    try {
      // Clean provisional stock deltas
      const stockKey = 'provisional_stock_deltas';
      const stockData = await AsyncStorage.getItem(stockKey);
      
      if (stockData) {
        const data = JSON.parse(stockData);
        const cleaned: any = {};
        
        for (const [productId, deltas] of Object.entries(data)) {
          const seenOpIds = new Set();
          const uniqueDeltas: any[] = [];
          
          for (const delta of deltas as any[]) {
            if (!seenOpIds.has(delta.opId)) {
              seenOpIds.add(delta.opId);
              uniqueDeltas.push(delta);
            } else {
              cleanedCount++;
            }
          }
          
          if (uniqueDeltas.length > 0) {
            cleaned[productId] = uniqueDeltas;
          }
        }
        
        await AsyncStorage.setItem(stockKey, JSON.stringify(cleaned));
      }

      // Clean provisional balance deltas
      const balanceKey = 'provisional_balance_deltas';
      const balanceData = await AsyncStorage.getItem(balanceKey);
      
      if (balanceData) {
        const data = JSON.parse(balanceData);
        const cleaned: any = {};
        
        for (const [playerId, deltas] of Object.entries(data)) {
          const seenOpIds = new Set();
          const uniqueDeltas: any[] = [];
          
          for (const delta of deltas as any[]) {
            if (!seenOpIds.has(delta.opId)) {
              seenOpIds.add(delta.opId);
              uniqueDeltas.push(delta);
            } else {
              cleanedCount++;
            }
          }
          
          if (uniqueDeltas.length > 0) {
            cleaned[playerId] = uniqueDeltas;
          }
        }
        
        await AsyncStorage.setItem(balanceKey, JSON.stringify(cleaned));
      }

      console.log(`🧹 Cleaned ${cleanedCount} duplicate operations`);
      return cleanedCount;

    } catch (error) {
      console.error('❌ Failed to cleanup duplicate operations:', error);
      throw error;
    }
  }
}