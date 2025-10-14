import React, { useEffect, useState } from 'react';
import { View, Text, SectionList, StyleSheet, Dimensions } from 'react-native';
import { hybridSyncService } from '../services/HybridSyncService';
import { useTheme } from '../app/ThemeContext';
import { useIsFocused } from '@react-navigation/native';

const { width } = Dimensions.get('window');

interface Product {
  id?: string;
  name: string;
  stock: number;
  price: number;
  category?: string;
  isActive?: boolean;
}

export default function StockTake() {
  const [outOfStock, setOutOfStock] = useState<Product[]>([]);
  const [inStock, setInStock] = useState<Product[]>([]);
  const { isDarkMode } = useTheme();
  const isFocused = useIsFocused(); // Detect if the screen is in focus

  // Load products using hybrid sync service
  const loadProducts = async () => {
    try {
      const productList = await hybridSyncService.getProductsWithOverlay(); // Use overlay to show provisional stock changes
      const activeProducts = productList.filter((product: Product) => product.isActive !== false);

      // Separate products into out of stock and in stock
      const outOfStockProducts = activeProducts.filter((product: Product) => product.stock === 0);
      const inStockProducts = activeProducts
        .filter((product: Product) => product.stock > 0)
        .sort((a: Product, b: Product) => a.stock - b.stock); // Sort in ascending order by stock

      setOutOfStock(outOfStockProducts);
      setInStock(inStockProducts);
    } catch (error) {
      console.error('Error loading products:', error);
    }
  };

  // Reload products whenever the page gains focus
  useEffect(() => {
    if (isFocused) {
      loadProducts();
    }
  }, [isFocused]);

  const getStockStyle = (quantity: number) => {
    if (quantity < 3) return styles.lowStock; // Orange
    if (quantity < 10) return styles.mediumStock; // Yellow
    return styles.highStock; // Green
  };

  const sections = [
    {
      title: 'Out of Stock',
      data: outOfStock,
      emptyMessage: 'No products are out of stock.',
      renderItem: ({ item }: { item: Product }) => (
        <View style={[styles.productRow, isDarkMode && styles.darkProductRow]}>
          <Text style={[styles.productName, isDarkMode && styles.darkProductName]}>{item.name}</Text>
          <Text style={[styles.outOfStockText, isDarkMode && styles.darkOutOfStockText]}>Out of Stock</Text>
        </View>
      ),
    },
    {
      title: 'Remaining Stock',
      data: inStock,
      emptyMessage: 'All products are out of stock.',
      renderItem: ({ item }: { item: Product }) => (
        <View style={[styles.productRow, isDarkMode && styles.darkProductRow]}>
          <Text style={[styles.productName, isDarkMode && styles.darkProductName]}>{item.name}</Text>
          <Text style={[styles.productQuantity, getStockStyle(item.stock)]}>
            {item.stock} remaining
          </Text>
        </View>
      ),
    },
  ];

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.name}-${index}`}
        renderSectionHeader={({ section }) => (
          <View>
            <Text style={[styles.header, isDarkMode && styles.darkHeader]}>{section.title}</Text>
            {section.data.length === 0 && (
              <Text style={[styles.emptyMessage, isDarkMode && styles.darkEmptyMessage]}>{section.emptyMessage}</Text>
            )}
          </View>
        )}
        renderItem={({ item, section }) => section.renderItem({ item })}
      />
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
    marginBottom: 10,
  },
  darkHeader: {
    color: '#fff',
  },
  emptyMessage: {
    fontSize: width > 600 ? 18 : 16,
    fontStyle: 'italic',
    marginBottom: 10,
    color: '#777',
  },
  darkEmptyMessage: {
    color: '#aaa',
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  darkProductRow: {
    borderBottomColor: '#555',
  },
  productName: {
    fontSize: width > 600 ? 18 : 16,
    fontWeight: '500',
  },
  darkProductName: {
    color: '#fff',
  },
  outOfStockText: {
    fontSize: width > 600 ? 18 : 16,
    fontWeight: '500',
    color: 'red',
  },
  darkOutOfStockText: {
    color: '#ffcccc',
  },
  productQuantity: {
    fontSize: width > 600 ? 18 : 16,
    fontWeight: '500',
  },
  lowStock: {
    color: '#FF5733', // Orange for stock less than 3
  },
  mediumStock: {
    color: '#FFBF00', // Yellow for stock less than 10
  },
  highStock: {
    color: 'green', // Green for stock 10 or more
  },
});
