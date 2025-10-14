import React, { useState, useEffect } from 'react';
import { 
  View, 
  TextInput, 
  FlatList, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions, 
  Alert,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback
} from 'react-native';
import { hybridSyncService } from '../services/HybridSyncService';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../app/ThemeContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { formatCurrency, getCurrencySymbol } from '../utils/currency';

const { width } = Dimensions.get('window');

interface Product {
  id?: string;
  name: string;
  stock: number;
  price: number;
  category?: string;
  barcode?: string;
  description?: string;
  isActive?: boolean;
  organizationId?: string;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState<string>('');
  const [stock, setStock] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [category, setCategory] = useState<string>('General');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [showCustomCategory, setShowCustomCategory] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const predefinedCategories = ['General', 'Alcohol', 'Crisps', 'Soft Drinks', 'Chocolate', 'Sweets', 'Snacks', 'Custom'];
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isOnline, setIsOnline] = useState(true);
  
  const { isDarkMode } = useTheme();
  const { organization } = useOrganization();

  // Load products using offline-first architecture
  const loadProducts = async () => {
    setIsLoading(true);
    try {
      console.log('🔄 ProductsPage: Loading products via offline-first architecture');
      
      // Use offline-first architecture - it handles online/offline automatically
      const hybridProducts = await hybridSyncService.getProductsWithOverlay(); // Use overlay to show provisional stock changes
      const compatibleProducts = hybridProducts.filter((p: any) => p.isActive !== false).map((p: any) => ({
        ...p,
        stock: p.stock ?? 0
      }));
      setProducts(compatibleProducts);
      
      console.log('✅ ProductsPage: Loaded products:', compatibleProducts.length);
    } catch (error) {
      console.error('❌ ProductsPage: Error loading products:', error);
      Alert.alert('Error', 'Failed to load products');
    } finally {
      setIsLoading(false);
    }
  };

  const updateNetworkStatus = async () => {
    const freshNetworkState = await hybridSyncService.refreshNetworkState();
    setIsOnline(freshNetworkState);
  };



  // Add product using hybrid sync
  const addProduct = async () => {
    if (name.trim() === '' || stock.trim() === '' || price.trim() === '') {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    const newProduct: Product = {
      name: name.trim(),
      stock: parseInt(stock),
      price: parseFloat(price),
      category: category.trim() || 'General',
      isActive: true,
      organizationId: organization?.id || 'unknown'
    };

    try {
      // Use hybrid sync service - it handles online/offline automatically
      const productId = await hybridSyncService.addProduct(newProduct);
      
      // Update local state immediately
      const productWithId = { ...newProduct, id: productId };
      setProducts(prev => [...prev, productWithId]);
      
      // Clear form
      setName('');
      setStock('');
      setPrice('');
      setCategory('General');
      
      Alert.alert('Success', 'Product added successfully');
    } catch (error) {
      console.error('Error adding product:', error);
      Alert.alert('Error', 'Failed to add product');
    }
  };

  // Update product using hybrid sync
  const updateProduct = async () => {
    if (editingIndex === null) return;
    
    const productToUpdate = products[editingIndex];
    if (!productToUpdate.id) return;

    const updates = {
      name: name.trim(),
      stock: parseInt(stock),
      price: parseFloat(price),
      category: category.trim() || 'General'
    };

    try {
      // Use hybrid sync service
      await hybridSyncService.updateProduct(productToUpdate.id, updates);
      
      // Update local state immediately
      const updatedProducts = [...products];
      updatedProducts[editingIndex] = { ...productToUpdate, ...updates };
      setProducts(updatedProducts);
      
      // Clear form and editing state
      setName('');
      setStock('');
      setPrice('');
      setCategory('General');
      setIsEditing(false);
      setEditingIndex(null);
      
      Alert.alert('Success', 'Product updated successfully');
    } catch (error) {
      console.error('Error updating product:', error);
      Alert.alert('Error', 'Failed to update product');
    }
  };

  // Delete product using hybrid sync
  const deleteProduct = (index: number) => {
    const productToDelete = products[index];
    if (!productToDelete.id) return;

    Alert.alert(
      'Delete Product',
      `Are you sure you want to delete "${productToDelete.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Use hybrid sync service
              await hybridSyncService.deleteProduct(productToDelete.id!);
              
              // Update local state immediately
              const updatedProducts = products.filter((_, i) => i !== index);
              setProducts(updatedProducts);
              
              Alert.alert('Success', 'Product deleted successfully');
            } catch (error) {
              console.error('Error deleting product:', error);
              Alert.alert('Error', 'Failed to delete product');
            }
          }
        }
      ]
    );
  };

  const editProduct = (index: number) => {
    const product = products[index];
    setName(product.name);
    setStock((product.stock ?? 0).toString());
    setPrice(product.price.toString());
    setCategory(product.category || 'General');
    setIsEditing(true);
    setEditingIndex(index);
  };

  const cancelEdit = () => {
    setName('');
    setStock('');
    setPrice('');
    setCategory('General');
    setIsEditing(false);
    setEditingIndex(null);
  };

  useEffect(() => {
    loadProducts();
    updateNetworkStatus();
    
    // Update network status every 2 seconds
    const networkInterval = setInterval(() => {
      updateNetworkStatus();
    }, 2000);

    return () => clearInterval(networkInterval);
  }, []);

  const renderProduct = ({ item, index }: { item: Product; index: number }) => (
    <View style={[styles.productCard, isDarkMode && styles.darkProductCard]}>
      <View style={styles.productInfo}>
        <Text style={[styles.productName, isDarkMode && styles.darkText]}>{item.name}</Text>
        <Text style={[styles.productDetails, isDarkMode && styles.darkSubText]}>
          Stock: {item.stock} • {formatCurrency(item.price, organization?.currency || 'GBP')}
        </Text>
        {item.category && (
          <Text style={[styles.productCategory, isDarkMode && styles.darkSubText]}>
            {item.category}
          </Text>
        )}
      </View>
      <View style={styles.productActions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.editButton]}
          onPress={() => editProduct(index)}
        >
          <Icon name="pencil" size={16} color="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={() => deleteProduct(index)}
        >
          <Icon name="delete" size={16} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      {/* Header with Network Status */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>
            Products Management
          </Text>
          <Text style={[styles.headerSubtitle, isDarkMode && styles.darkSubtitle]}>
            Manage your inventory
          </Text>
        </View>
        <View style={styles.headerRight}>
        </View>
      </View>

      {/* Form - Wrapped separately for keyboard dismissal */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={[styles.form, isDarkMode && styles.darkForm]}>
        <TextInput
          style={[styles.input, isDarkMode && styles.darkInput]}
          placeholder="Product Name"
          placeholderTextColor={isDarkMode ? '#888' : '#666'}
          value={name}
          onChangeText={setName}
          returnKeyType="next"
          onSubmitEditing={Keyboard.dismiss}
        />
        <TextInput
          style={[styles.input, isDarkMode && styles.darkInput]}
          placeholder="Stock Quantity"
          placeholderTextColor={isDarkMode ? '#888' : '#666'}
          value={stock}
          onChangeText={setStock}
          keyboardType="numeric"
          returnKeyType="next"
          onSubmitEditing={Keyboard.dismiss}
        />
        <TextInput
          style={[styles.input, isDarkMode && styles.darkInput]}
          placeholder={`Price (${getCurrencySymbol(organization?.currency || 'GBP')})`}
          placeholderTextColor={isDarkMode ? '#888' : '#666'}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />
        <View style={styles.categoryContainer}>
          <Text style={[styles.label, isDarkMode && styles.darkText]}>Category</Text>
          <View style={styles.categoryDropdown}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
              {predefinedCategories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryOption,
                    category === cat && styles.selectedCategory,
                    isDarkMode && styles.darkCategoryOption
                  ]}
                  onPress={() => {
                    if (cat === 'Custom') {
                      setShowCustomCategory(true);
                      setCategory('');
                    } else {
                      setCategory(cat);
                      setShowCustomCategory(false);
                      setCustomCategory('');
                    }
                  }}
                >
                  <Text style={[
                    styles.categoryOptionText,
                    category === cat && styles.selectedCategoryText,
                    isDarkMode && styles.darkText
                  ]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          
          {showCustomCategory && (
            <TextInput
              style={[styles.input, styles.customCategoryInput, isDarkMode && styles.darkInput]}
              placeholder="Enter custom category"
              placeholderTextColor={isDarkMode ? '#888' : '#666'}
              value={customCategory}
              onChangeText={(text) => {
                setCustomCategory(text);
                setCategory(text);
              }}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
          )}
        </View>

        <View style={styles.buttonRow}>
          {isEditing ? (
            <>
              <TouchableOpacity style={styles.saveButton} onPress={updateProduct}>
                <Text style={styles.saveButtonText}>Update Product</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={cancelEdit}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.addButton} onPress={addProduct}>
              <Text style={styles.addButtonText}>Add Product</Text>
            </TouchableOpacity>
          )}
        </View>
        </View>
      </TouchableWithoutFeedback>

      {/* Products List - Free from TouchableWithoutFeedback for proper iOS scrolling */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, isDarkMode && styles.darkText]}>
            Loading products...
          </Text>
        </View>
      ) : (
        <FlatList
          data={products}
          renderItem={renderProduct}
          keyExtractor={(item, index) => item.id || index.toString()}
          style={styles.productList}
          contentContainerStyle={styles.productListContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

// ... (keep the existing styles and add new ones)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  darkContainer: {
    backgroundColor: '#121212',
  },
  form: {
    backgroundColor: '#FFF',
    padding: 20,
    borderRadius: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  darkForm: {
    backgroundColor: '#1E1E1E',
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    fontSize: 16,
    backgroundColor: '#FFF',
  },
  darkInput: {
    backgroundColor: '#2C2C2C',
    borderColor: '#444',
    color: '#FFF',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  addButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
  },
  addButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    marginRight: 10,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  cancelButton: {
    backgroundColor: '#757575',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
  },
  cancelButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  productList: {
    flex: 1,
  },
  productListContent: {
    paddingBottom: 20, // Extra padding for iOS scrolling
  },
  productCard: {
    backgroundColor: '#FFF',
    padding: 15,
    marginBottom: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  darkProductCard: {
    backgroundColor: '#1E1E1E',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  darkText: {
    color: '#FFF',
  },
  productDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  darkSubText: {
    color: '#AAA',
  },
  productCategory: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
  productActions: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: 8,
    borderRadius: 6,
    marginLeft: 8,
  },
  editButton: {
    backgroundColor: '#2196F3',
  },
  deleteButton: {
    backgroundColor: '#F44336',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  // Category dropdown styles
  categoryContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  categoryDropdown: {
    marginBottom: 8,
  },
  categoryScroll: {
    flexGrow: 0,
  },
  categoryOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f5f5f5',
  },
  selectedCategory: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  darkCategoryOption: {
    backgroundColor: '#333',
    borderColor: '#555',
  },
  categoryOptionText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  selectedCategoryText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  customCategoryInput: {
    marginTop: 8,
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
    flexDirection: 'row',
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
  syncButton: {
    padding: 8,
    marginRight: 8,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  globeIcon: {
    marginBottom: 4,
  },
  syncBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
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
});