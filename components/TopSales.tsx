import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { hybridSyncService } from '../services/HybridSyncService';
import { useTheme } from '../app/ThemeContext';
import { useIsFocused } from '@react-navigation/native';

const { width } = Dimensions.get('window');

interface TopSelling {
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
  averagePrice: number;
}

export default function TopSellingStock() {
  const [topSelling, setTopSelling] = useState<TopSelling[]>([]);
  const [loading, setLoading] = useState(false);
  const { isDarkMode } = useTheme();
  const isFocused = useIsFocused();

  const loadTopSelling = async () => {
    setLoading(true);
    try {
      console.log('🏆 TopSales: Loading assignments with provisional overlays');
      const assignments = await hybridSyncService.getAssignmentsWithOverlay();
      
      // Group assignments by product
      const productStats: { [productName: string]: { quantities: number[], revenues: number[] } } = {};
      
      assignments.forEach((assignment: any) => {
        const productName = assignment.productName || assignment.product;
        if (!productName) return;
        
        if (!productStats[productName]) {
          productStats[productName] = { quantities: [], revenues: [] };
        }
        
        const quantity = assignment.quantity || 1;
        const revenue = assignment.total || assignment.totalAmount || 0;
        
        productStats[productName].quantities.push(quantity);
        productStats[productName].revenues.push(typeof revenue === 'number' ? revenue : 0);
      });
      
      // Calculate totals and averages
      const topSellingData: TopSelling[] = Object.keys(productStats)
        .map(productName => {
          const quantities = productStats[productName].quantities;
          const revenues = productStats[productName].revenues;
          
          const totalQuantity = quantities.reduce((sum, q) => sum + q, 0);
          const totalRevenue = revenues.reduce((sum, r) => sum + r, 0);
          const averagePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
          
          return {
            productName,
            totalQuantity,
            totalRevenue,
            averagePrice
          };
        })
        .sort((a, b) => b.totalQuantity - a.totalQuantity); // Sort by quantity sold
      
      setTopSelling(topSellingData);
    } catch (error) {
      console.error('Error loading top-selling data:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isFocused) {
      loadTopSelling();
    }
  }, [isFocused]);

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <Text style={[styles.header, isDarkMode && styles.darkHeader]}>Top Selling Products</Text>
      {topSelling.length === 0 ? (
        <Text style={[styles.emptyMessage, isDarkMode && styles.darkEmptyMessage]}>
          {loading ? 'Loading sales data...' : 'No sales data available.'}
        </Text>
      ) : (
        <FlatList
          data={topSelling}
          keyExtractor={(item) => item.productName}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={loadTopSelling} />
          }
          renderItem={({ item, index }) => (
            <View style={[styles.productRow, isDarkMode && styles.darkProductRow]}>
              <View style={styles.rankContainer}>
                <Text style={[styles.rank, isDarkMode && styles.darkRank]}>#{index + 1}</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={[styles.productName, isDarkMode && styles.darkProductName]}>
                  {item.productName}
                </Text>
                <Text style={[styles.productStats, isDarkMode && styles.darkProductStats]}>
                  {item.totalQuantity} sold • £{item.totalRevenue.toFixed(2)} revenue
                </Text>
                <Text style={[styles.averagePrice, isDarkMode && styles.darkAveragePrice]}>
                  Avg: £{item.averagePrice.toFixed(2)} each
                </Text>
              </View>
              <View style={styles.quantityContainer}>
                <Text style={[styles.quantity, isDarkMode && styles.darkQuantity]}>
                  {item.totalQuantity}
                </Text>
                <Text style={[styles.quantityLabel, isDarkMode && styles.darkQuantityLabel]}>
                  sold
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: width > 600 ? 40 : 20,
    backgroundColor: '#fff',
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  header: {
    fontSize: width > 600 ? 24 : 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  darkHeader: {
    color: '#fff',
  },
  emptyMessage: {
    fontSize: width > 600 ? 18 : 16,
    fontStyle: 'italic',
    marginBottom: 10,
    color: '#777',
    textAlign: 'center',
    marginTop: 50,
  },
  darkEmptyMessage: {
    color: '#aaa',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  darkProductRow: {
    borderBottomColor: '#555',
  },
  rankContainer: {
    width: 40,
    alignItems: 'center',
    marginRight: 15,
  },
  rank: {
    fontSize: width > 600 ? 18 : 16,
    fontWeight: 'bold',
    color: '#666',
  },
  darkRank: {
    color: '#999',
  },
  productInfo: {
    flex: 1,
    marginRight: 15,
  },
  productName: {
    fontSize: width > 600 ? 18 : 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  darkProductName: {
    color: '#fff',
  },
  productStats: {
    fontSize: width > 600 ? 14 : 12,
    color: '#666',
    marginBottom: 2,
  },
  darkProductStats: {
    color: '#999',
  },
  averagePrice: {
    fontSize: width > 600 ? 12 : 10,
    color: '#2e7d32',
    fontWeight: '500',
  },
  darkAveragePrice: {
    color: '#4caf50',
  },
  quantityContainer: {
    alignItems: 'center',
    minWidth: 60,
  },
  quantity: {
    fontSize: width > 600 ? 20 : 18,
    fontWeight: 'bold',
    color: '#2e7d32',
  },
  darkQuantity: {
    color: '#4caf50',
  },
  quantityLabel: {
    fontSize: width > 600 ? 12 : 10,
    color: '#666',
  },
  darkQuantityLabel: {
    color: '#999',
  },
});
