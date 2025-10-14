import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseService, Product, User, Assignment, Report } from './FirebaseService';

export class DataMigrationService {
  private migrationKey = 'firebase_migration_completed';

  // Check if migration has already been completed
  async isMigrationCompleted(): Promise<boolean> {
    try {
      const migrationStatus = await AsyncStorage.getItem(this.migrationKey);
      return migrationStatus === 'true';
    } catch (error) {
      console.error('Error checking migration status:', error);
      return false;
    }
  }

  // Mark migration as completed
  async markMigrationCompleted(): Promise<void> {
    try {
      await AsyncStorage.setItem(this.migrationKey, 'true');
    } catch (error) {
      console.error('Error marking migration completed:', error);
    }
  }

  // Get existing data from AsyncStorage
  async getExistingData(): Promise<{
    products: Product[];
    users: User[];
    assignments: Assignment[];
    reports: Report[];
  }> {
    try {
      const [productsData, usersData, assignmentsData, reportsData] = await Promise.all([
        AsyncStorage.getItem('products'),
        AsyncStorage.getItem('users'),
        AsyncStorage.getItem('assignments'),
        AsyncStorage.getItem('reports')
      ]);

      const products: Product[] = productsData ? JSON.parse(productsData) : [];
      const users: User[] = usersData ? JSON.parse(usersData) : [];
      const assignments: Assignment[] = assignmentsData ? JSON.parse(assignmentsData) : [];
      const reports: Report[] = reportsData ? JSON.parse(reportsData) : [];

      // Transform data to Firebase format - filter out undefined values
      const transformedProducts = products.map(product => {
        const transformed: any = {
          name: product.name || '',
          price: product.price || 0,
          stock: (product as any).stock || (product as any).quantity || 0,
          category: product.category || 'General',
          isActive: true,
          organizationId: 'vale-madrid-tuck-shop'
        };
        
        // Only add optional fields if they have values
        if (product.barcode !== undefined && product.barcode !== null && product.barcode !== '') {
          transformed.barcode = product.barcode;
        }
        if (product.description !== undefined && product.description !== null && product.description !== '') {
          transformed.description = product.description;
        }
        
        return transformed;
      });

      const transformedUsers = users.map(user => {
        const profile: any = {
          firstName: user.profile?.firstName || '',
          lastName: user.profile?.lastName || ''
        };
        
        // Only add optional fields if they have values
        if (user.profile?.department !== undefined && user.profile?.department !== null && user.profile?.department !== '') {
          profile.department = user.profile.department;
        }
        if (user.profile?.position !== undefined && user.profile?.position !== null && user.profile?.position !== '') {
          profile.position = user.profile.position;
        }
        
        return {
          uid: user.uid || '',
          email: user.email || '',
          displayName: user.displayName || user.profile?.firstName + ' ' + user.profile?.lastName || 'Unknown User',
          role: user.role || 'user' as 'admin' | 'manager' | 'user',
          organizationId: 'vale-madrid-tuck-shop',
          isActive: true,
          permissions: user.permissions || {
            canManageProducts: false,
            canManageUsers: false,
            canViewReports: false,
            canManageAssignments: false,
            canPerformStockTake: false,
            isAdmin: false
          },
          profile
        };
      });

      const transformedAssignments = assignments.map((assignment: any) => ({
        playerId: assignment.userId || assignment.playerId || '', // Map old userId to playerId
        playerName: assignment.userName || assignment.playerName || '', // Map old userName to playerName
        createdByUserId: 'admin', // Default to admin for migrated data
        createdByUserName: 'Admin User', // Default name for migrated data
        productId: assignment.productId || '',
        productName: assignment.productName || '',
        quantity: assignment.quantity || 0,
        price: assignment.price || 0,
        totalAmount: assignment.totalAmount || 0,
        date: assignment.date || new Date().toISOString().split('T')[0],
        status: assignment.status || 'completed' as 'pending' | 'completed' | 'cancelled',
        organizationId: 'vale-madrid-tuck-shop'
      }));

      const transformedReports = reports.map(report => ({
        title: report.title || 'Migrated Report',
        type: report.type || 'custom' as 'sales' | 'stock' | 'user' | 'custom',
        data: report.data || {},
        dateRange: report.dateRange || {
          start: new Date().toISOString().split('T')[0],
          end: new Date().toISOString().split('T')[0]
        },
        generatedBy: 'Migration Service',
        organizationId: 'vale-madrid-tuck-shop'
      }));

      return {
        products: transformedProducts,
        users: transformedUsers,
        assignments: transformedAssignments,
        reports: transformedReports
      };
    } catch (error) {
      console.error('Error getting existing data:', error);
      return {
        products: [],
        users: [],
        assignments: [],
        reports: []
      };
    }
  }

  // Perform the complete migration
  async performMigration(): Promise<{
    success: boolean;
    message: string;
    migratedCounts: {
      products: number;
      users: number;
      assignments: number;
      reports: number;
    };
  }> {
    try {
      // Check if migration already completed
      if (await this.isMigrationCompleted()) {
        return {
          success: true,
          message: 'Migration already completed',
          migratedCounts: { products: 0, users: 0, assignments: 0, reports: 0 }
        };
      }

      console.log('Starting data migration from AsyncStorage to Firebase...');

      // STEP 1: Clean and normalize legacy AsyncStorage data
      console.log('🧹 Cleaning legacy AsyncStorage data...');
      await this.cleanLegacyAsyncStorageData();

      // Get existing data from AsyncStorage
      const existingData = await this.getExistingData();

      const counts = {
        products: existingData.products.length,
        users: existingData.users.length,
        assignments: existingData.assignments.length,
        reports: existingData.reports.length
      };

      console.log('Found data to migrate:', counts);

      // Only migrate if there's data to migrate
      if (counts.products > 0 || counts.users > 0 || counts.assignments > 0 || counts.reports > 0) {
        // Perform the migration using Firebase batch operations
        await firebaseService.migrateData(existingData);
        
        console.log('Migration completed successfully');
      }

      // Mark migration as completed
      await this.markMigrationCompleted();

      return {
        success: true,
        message: `Migration completed successfully. Migrated ${counts.products} products, ${counts.users} users, ${counts.assignments} assignments, and ${counts.reports} reports.`,
        migratedCounts: counts
      };

    } catch (error: any) {
      console.error('Error during migration:', error);
      return {
        success: false,
        message: `Migration failed: ${error.message || 'Unknown error'}`,
        migratedCounts: { products: 0, users: 0, assignments: 0, reports: 0 }
      };
    }
  }

  // Create backup of AsyncStorage data before migration
  async createBackup(): Promise<void> {
    try {
      const existingData = await this.getExistingData();
      const backup = {
        timestamp: new Date().toISOString(),
        data: existingData
      };
      
      await AsyncStorage.setItem('migration_backup', JSON.stringify(backup));
      console.log('Backup created successfully');
    } catch (error) {
      console.error('Error creating backup:', error);
    }
  }

  // Reset migration status (for testing purposes)
  async resetMigrationStatus(): Promise<void> {
    try {
      await AsyncStorage.removeItem(this.migrationKey);
      console.log('Migration status reset');
    } catch (error) {
      console.error('Error resetting migration status:', error);
    }
  }

  // Clean and normalize legacy AsyncStorage data
  async cleanLegacyAsyncStorageData(): Promise<void> {
    try {
      console.log('🧹 Starting legacy data cleaning...');
      
      // Create backup first
      await this.createBackup();
      
      // Clean assignments
      await this.cleanLegacyAssignments();
      
      // Clean products
      await this.cleanLegacyProducts();
      
      // Clean users
      await this.cleanLegacyUsers();
      
      console.log('✅ Legacy data cleaning completed');
    } catch (error) {
      console.error('❌ Error during legacy data cleaning:', error);
      throw error;
    }
  }

  private async cleanLegacyAssignments(): Promise<void> {
    try {
      const assignmentsData = await AsyncStorage.getItem('assignments');
      if (!assignmentsData) return;
      
      const assignments = JSON.parse(assignmentsData);
      const cleanedAssignments = assignments.map((assignment: any, index: number) => {
        // Ensure we have the new format
        const playerName = assignment.playerName || assignment.user || 'Unknown Player';
        const productName = assignment.productName || assignment.product || 'Unknown Product';
        const quantity = typeof assignment.quantity === 'number' && !isNaN(assignment.quantity) ? assignment.quantity : 1;
        const total = assignment.totalAmount || assignment.total || 0;
        const validTotal = typeof total === 'number' && !isNaN(total) ? total : 0;
        const price = quantity > 0 ? validTotal / quantity : 0;

        return {
          id: assignment.id || `legacy_${Date.now()}_${index}`,
          playerId: playerName,
          playerName: playerName,
          createdByUserId: 'legacy-user',
          createdByUserName: 'Legacy User',
          productId: productName,
          productName: productName,
          quantity: quantity,
          price: price,
          totalAmount: validTotal,
          date: assignment.date || new Date().toLocaleDateString('en-GB').replace(/\//g, '.'),
          status: 'completed',
          paid: Boolean(assignment.paid),
          organizationId: 'vale-madrid-tuck-shop'
        };
      });

      await AsyncStorage.setItem('assignments', JSON.stringify(cleanedAssignments));
      console.log(`🧹 Cleaned ${cleanedAssignments.length} assignments`);
    } catch (error) {
      console.error('Error cleaning legacy assignments:', error);
      throw error;
    }
  }

  private async cleanLegacyProducts(): Promise<void> {
    try {
      const productsData = await AsyncStorage.getItem('products');
      if (!productsData) return;
      
      const products = JSON.parse(productsData);
      const cleanedProducts = products.map((product: any, index: number) => ({
        id: product.id || `product_${index}`,
        name: product.name || `Product ${index}`,
        price: typeof product.price === 'number' && !isNaN(product.price) ? product.price : 0,
        stock: typeof product.stock === 'number' && !isNaN(product.stock) ? product.stock : 
               typeof product.quantity === 'number' && !isNaN(product.quantity) ? product.quantity : 0,
        quantity: typeof product.quantity === 'number' && !isNaN(product.quantity) ? product.quantity : 
                 typeof product.stock === 'number' && !isNaN(product.stock) ? product.stock : 0,
        category: product.category || 'General',
        isActive: product.isActive !== false,
        organizationId: 'vale-madrid-tuck-shop'
      }));

      await AsyncStorage.setItem('products', JSON.stringify(cleanedProducts));
      console.log(`🧹 Cleaned ${cleanedProducts.length} products`);
    } catch (error) {
      console.error('Error cleaning legacy products:', error);
      throw error;
    }
  }

  private async cleanLegacyUsers(): Promise<void> {
    try {
      const usersData = await AsyncStorage.getItem('users');
      if (!usersData) return;
      
      const users = JSON.parse(usersData);
      const cleanedUsers = users.map((user: any, index: number) => {
        if (typeof user === 'string') {
          return user; // Keep simple string format for backward compatibility
        } else if (user && user.name) {
          return user.name; // Extract name from object
        } else {
          return `Player ${index}`; // Default name
        }
      });

      await AsyncStorage.setItem('users', JSON.stringify(cleanedUsers));
      console.log(`🧹 Cleaned ${cleanedUsers.length} users`);
    } catch (error) {
      console.error('Error cleaning legacy users:', error);
      throw error;
    }
  }
}

// Create singleton instance
export const dataMigrationService = new DataMigrationService();
export default dataMigrationService;