import AsyncStorage from '@react-native-async-storage/async-storage';

interface LegacyAssignment {
  user?: string;
  product?: string;
  quantity?: number;
  total?: number;
  date?: string;
  paid?: boolean;
  id?: string;
}

interface ModernAssignment {
  id: string;
  playerId: string;
  playerName: string;
  createdByUserId: string;
  createdByUserName: string;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  totalAmount: number;
  date: string;
  status: 'completed';
  paid: boolean;
  organizationId: string;
}

export class LegacyDataMigrator {
  
  static async migrateAllData(): Promise<void> {
    console.log('🔄 Starting legacy data migration...');
    
    try {
      // Migrate assignments
      await this.migrateAssignments();
      
      // Migrate products (ensure they have proper structure)
      await this.migrateProducts();
      
      // Migrate users to players format
      await this.migrateUsersToPlayers();
      
      console.log('✅ Legacy data migration completed successfully');
    } catch (error) {
      console.error('❌ Error during data migration:', error);
      throw error;
    }
  }
  
  static async migrateAssignments(): Promise<void> {
    console.log('📋 Migrating assignments...');
    
    try {
      const assignmentsData = await AsyncStorage.getItem('assignments');
      if (!assignmentsData) {
        console.log('📋 No assignments to migrate');
        return;
      }
      
      const rawAssignments = JSON.parse(assignmentsData);
      const migratedAssignments: ModernAssignment[] = [];
      
      rawAssignments.forEach((assignment: any, index: number) => {
        try {
          const migrated = this.convertLegacyAssignment(assignment, index);
          if (migrated) {
            migratedAssignments.push(migrated);
          }
        } catch (error) {
          console.warn(`⚠️ Skipping invalid assignment at index ${index}:`, assignment, error);
        }
      });
      
      // Save migrated assignments
      await AsyncStorage.setItem('assignments', JSON.stringify(migratedAssignments));
      console.log(`📋 Migrated ${migratedAssignments.length} assignments`);
      
    } catch (error) {
      console.error('❌ Error migrating assignments:', error);
      throw error;
    }
  }
  
  static convertLegacyAssignment(legacy: any, fallbackIndex: number): ModernAssignment | null {
    // Validate required fields - handle both missing fields and empty strings from Firebase
    const playerName = legacy.playerName || legacy.user || legacy.userName;
    const productName = legacy.productName || legacy.product;
    const quantity = legacy.quantity;
    const total = legacy.totalAmount || legacy.total;
    const date = legacy.date;
    
    // Skip assignments with empty/missing critical fields, but be more lenient
    if (!quantity || !date) {
      console.warn('⚠️ Missing critical fields in assignment:', legacy);
      return null;
    }
    
    // For empty player/product names, use fallback values instead of rejecting
    const validPlayerName = playerName && playerName.trim() ? playerName : `Unknown Player ${fallbackIndex}`;
    const validProductName = productName && productName.trim() ? productName : `Unknown Product ${fallbackIndex}`;
    
    // Ensure total is a valid number
    const validTotal = typeof total === 'number' && !isNaN(total) ? total : 0;
    const validQuantity = typeof quantity === 'number' && !isNaN(quantity) ? quantity : 1;
    const price = validQuantity > 0 ? validTotal / validQuantity : 0;
    
    return {
      id: legacy.id || `migrated_${Date.now()}_${fallbackIndex}`,
      playerId: validPlayerName, // Using name as ID for now
      playerName: validPlayerName,
      createdByUserId: 'legacy-user',
      createdByUserName: 'Legacy User',
      productId: validProductName, // Using name as ID for now
      productName: validProductName,
      quantity: validQuantity,
      price: price,
      totalAmount: validTotal,
      date: date,
      status: 'completed' as const,
      paid: Boolean(legacy.paid),
      organizationId: 'vale-madrid-tuck-shop'
    };
  }
  
  static async migrateProducts(): Promise<void> {
    console.log('📦 Migrating products...');
    
    try {
      const productsData = await AsyncStorage.getItem('products');
      if (!productsData) {
        console.log('📦 No products to migrate');
        return;
      }
      
      const rawProducts = JSON.parse(productsData);
      const migratedProducts = rawProducts.map((product: any, index: number) => {
        // Ensure all products have required fields with defaults
        return {
          id: product.id || `product_${index}`,
          name: product.name || `Product ${index}`,
          price: typeof product.price === 'number' && !isNaN(product.price) ? product.price : 0,
          stock: typeof product.stock === 'number' && !isNaN(product.stock) ? product.stock : 
                 typeof product.quantity === 'number' && !isNaN(product.quantity) ? product.quantity : 0,
          quantity: typeof product.quantity === 'number' && !isNaN(product.quantity) ? product.quantity : 
                   typeof product.stock === 'number' && !isNaN(product.stock) ? product.stock : 0,
          category: product.category || 'General',
          isActive: product.isActive !== false, // Default to true unless explicitly false
          organizationId: 'vale-madrid-tuck-shop'
        };
      });
      
      await AsyncStorage.setItem('products', JSON.stringify(migratedProducts));
      console.log(`📦 Migrated ${migratedProducts.length} products`);
      
    } catch (error) {
      console.error('❌ Error migrating products:', error);
      throw error;
    }
  }
  
  static async migrateUsersToPlayers(): Promise<void> {
    console.log('👤 Migrating users to players...');
    
    try {
      const usersData = await AsyncStorage.getItem('users');
      if (!usersData) {
        console.log('👤 No users to migrate');
        return;
      }
      
      const rawUsers = JSON.parse(usersData);
      const players = rawUsers.map((user: any, index: number) => {
        if (typeof user === 'string') {
          return {
            id: user,
            name: user,
            organizationId: 'vale-madrid-tuck-shop',
            isActive: true
          };
        } else if (user && user.name) {
          return {
            id: user.id || user.name,
            name: user.name,
            organizationId: 'vale-madrid-tuck-shop',
            isActive: user.isActive !== false
          };
        } else {
          return {
            id: `player_${index}`,
            name: `Player ${index}`,
            organizationId: 'vale-madrid-tuck-shop',
            isActive: true
          };
        }
      });
      
      // Save as both users (for backward compatibility) and players
      await AsyncStorage.setItem('users', JSON.stringify(players.map((p: any) => p.name)));
      await AsyncStorage.setItem('players', JSON.stringify(players));
      console.log(`👤 Migrated ${players.length} players`);
      
    } catch (error) {
      console.error('❌ Error migrating users to players:', error);
      throw error;
    }
  }
  
  static async validateMigratedData(): Promise<boolean> {
    console.log('✅ Validating migrated data...');
    
    try {
      // Check assignments
      const assignmentsData = await AsyncStorage.getItem('assignments');
      if (assignmentsData) {
        const assignments = JSON.parse(assignmentsData);
        for (const assignment of assignments) {
          if (!assignment.playerName || typeof assignment.totalAmount !== 'number' || isNaN(assignment.totalAmount)) {
            console.error('❌ Invalid assignment found:', assignment);
            return false;
          }
        }
      }
      
      // Check products
      const productsData = await AsyncStorage.getItem('products');
      if (productsData) {
        const products = JSON.parse(productsData);
        for (const product of products) {
          if (!product.name || typeof product.price !== 'number' || isNaN(product.price)) {
            console.error('❌ Invalid product found:', product);
            return false;
          }
        }
      }
      
      console.log('✅ Data validation passed');
      return true;
      
    } catch (error) {
      console.error('❌ Error validating data:', error);
      return false;
    }
  }
  
  static async backupLegacyData(): Promise<void> {
    console.log('💾 Creating backup of legacy data...');
    
    try {
      const assignments = await AsyncStorage.getItem('assignments');
      const products = await AsyncStorage.getItem('products');
      const users = await AsyncStorage.getItem('users');
      
      const backup = {
        timestamp: Date.now(),
        assignments,
        products,
        users
      };
      
      await AsyncStorage.setItem('legacy_data_backup', JSON.stringify(backup));
      console.log('💾 Legacy data backed up successfully');
      
    } catch (error) {
      console.error('❌ Error backing up legacy data:', error);
      throw error;
    }
  }
}