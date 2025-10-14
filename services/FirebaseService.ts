import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  Timestamp,
  increment
} from 'firebase/firestore';
import { FirebaseFirestore } from '../config/firebase';
import { generateUUID } from '../utils/uuid';
import { formatCurrency } from '../utils/currency';

// Types for our data models
export interface Product {
  id: string;  // Required for logical ID consistency
  name: string;
  price: number;
  stock: number;  // Added missing stock field
  category: string;
  barcode?: string;
  description?: string;
  isActive: boolean;
  organizationId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Staff users who operate the app (admins, cashiers, managers)
export interface StaffUser {
  id?: string;
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'manager' | 'cashier' | 'user';
  organizationId: string;
  isActive: boolean;
  permissions: {
    canManageProducts: boolean;
    canManageUsers: boolean;
    canViewReports: boolean;
    canManageAssignments: boolean;
    canPerformStockTake: boolean;
    isAdmin: boolean;
  };
  profile: {
    firstName: string;
    lastName: string;
    department?: string;
    position?: string;
  };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// For backward compatibility - will be deprecated
export interface User extends StaffUser {}

// Players/customers who buy items (current 'users' in the app)
export interface Player {
  id?: string;
  name: string; // For compatibility with existing UsersPage
  firstName?: string;
  lastName?: string;
  email?: string;
  assignedUserId?: string; // Firebase Auth UID of the assigned user
  assignedUserEmail?: string; // Email of the assigned user for easy reference
  grade?: string;
  studentId?: string;
  house?: string;
  balance: number;
  totalPurchases: number;
  totalSpent: number;
  isActive: boolean;
  parentEmail?: string;
  parentPhone?: string;
  notes?: string;
  organizationId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Assignment {
  id?: string;
  playerId: string; // Links to Player collection
  playerName: string;
  createdByUserId: string; // Links to User who created the sale
  createdByUserName: string;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  totalAmount: number;
  date: string;
  status: 'pending' | 'completed' | 'cancelled';
  // Payment tracking
  paid?: boolean;
  paidAt?: Timestamp;
  paidBy?: string; // User ID who processed payment
  paidByUserName?: string;
  organizationId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Report {
  id?: string;
  title: string;
  type: 'sales' | 'stock' | 'user' | 'custom';
  data: any;
  dateRange: {
    start: string;
    end: string;
  };
  generatedBy: string;
  organizationId: string;
  createdAt?: Timestamp;
}

// Firebase Service Class
export class FirebaseService {
  private organizationId: string;

  constructor(organizationId?: string) {
    // Default to empty string if no organizationId provided - will throw error on use
    this.organizationId = organizationId || '';
  }

  // Method to set organization ID after construction
  setOrganizationId(organizationId: string) {
    if (!organizationId) {
      throw new Error('Organization ID cannot be empty');
    }
    this.organizationId = organizationId;
  }

  // Method to check if service is ready for use
  isReady(): boolean {
    return !!this.organizationId;
  }

  // Helper method to get organization collection path
  private getOrgCollection(collectionName: string) {
    // Ensure organizationId is valid to prevent path issues
    if (!this.organizationId) {
      throw new Error(`FirebaseService: Organization ID not set. Call setOrganizationId() first.`);
    }
    return `organizations/${this.organizationId}/${collectionName}`;
  }

  // ============================================
  // IDEMPOTENCY TRACKING (from MD specification)
  // ============================================

  /**
   * Check if an operation ID has already been applied
   */
  async isOpIdApplied(opId: string): Promise<boolean> {
    try {
      const opRef = doc(FirebaseFirestore, this.getOrgCollection('appliedOps'), opId);
      const opDoc = await getDoc(opRef);
      return opDoc.exists();
    } catch (error) {
      console.error('Error checking opId:', error);
      return false;
    }
  }

  /**
   * Mark an operation ID as applied
   */
  async markOpIdApplied(opId: string, bundleId?: string, metadata?: any): Promise<void> {
    try {
      const opRef = doc(FirebaseFirestore, this.getOrgCollection('appliedOps'), opId);
      await setDoc(opRef, {
        opId,
        bundleId: bundleId || null,
        appliedAt: serverTimestamp(),
        metadata: metadata || null
      });
    } catch (error) {
      console.error('Error marking opId as applied:', error);
      throw error;
    }
  }

  /**
   * Apply bundle transaction with idempotency (from MD specification)
   */
  async applyBundleTransaction(bundle: any): Promise<any[]> {
    console.log('🔥 Starting bundle transaction:', bundle.bundleId);
    
    if (!bundle || !bundle.steps || !Array.isArray(bundle.steps)) {
      throw new Error('Invalid bundle: missing or invalid steps array');
    }
    
    const batch = writeBatch(FirebaseFirestore);
    const acks: any[] = [];
    
    try {
      // Check each step for idempotency
      for (const step of bundle.steps) {
        if (!step || !step.opId) {
          console.error('❌ Invalid step in bundle:', step);
          throw new Error('Invalid step: missing opId');
        }
        
        const isAlreadyApplied = await this.isOpIdApplied(step.opId);
        
        if (isAlreadyApplied) {
          console.log(`⚠️ OpId ${step.opId} already applied, skipping`);
          acks.push({ opId: step.opId, appliedAt: Date.now(), skipped: true });
          continue;
        }

        // Apply the step
        switch (step.kind) {
          case 'createAssignment':
            await this.batchCreateAssignment(batch, step.payload);
            break;
          case 'stockDelta':
            await this.batchAppendStockDelta(batch, step.payload);
            break;
          case 'balanceDelta':
            await this.batchAppendBalanceDelta(batch, step.payload, bundle.type);
            break;
          case 'stockTakeRebase':
            await this.batchApplyStockTakeRebase(batch, step.payload);
            break;
          case 'updateAssignment':
            await this.batchUpdateAssignment(batch, step.assignment);
            break;
          case 'updatePlayerBalance':
            await this.batchAppendBalanceDelta(batch, {
              playerId: step.player.playerId,
              delta: step.player.balanceDelta,
              reason: step.player.reason || 'Payment received'
            }, bundle.type);
            break;
          case 'updateOrganization':
            await this.batchUpdateOrganization(batch, step.organization);
            break;
          case 'createCharge':
            await this.batchCreateCharge(batch, step.payload);
            break;
          case 'updateCharge':
            await this.batchUpdateCharge(batch, step.payload);
            break;
          case 'deleteCharge':
            await this.batchDeleteCharge(batch, step.payload);
            break;
          default:
            console.error(`❌ Unknown bundle step kind: ${step.kind}`);
            throw new Error(`Unsupported bundle step kind: ${step.kind}`);
        }

        // Mark step as applied
        const opRef = doc(FirebaseFirestore, this.getOrgCollection('appliedOps'), step.opId);
        
        // Get metadata based on step type
        let metadata;
        switch (step.kind) {
          case 'updateAssignment':
            metadata = step.assignment;
            break;
          case 'updatePlayerBalance':
            metadata = step.player;
            break;
          case 'updateOrganization':
            metadata = step.organization;
            break;
          default:
            metadata = step.payload;
            break;
        }
        
        batch.set(opRef, {
          opId: step.opId,
          bundleId: bundle.bundleId,
          appliedAt: serverTimestamp(),
          step: step.kind,
          metadata: metadata || {} // Ensure metadata is never undefined
        });

        acks.push({ opId: step.opId, appliedAt: Date.now() });
      }

      // Commit all changes atomically
      await batch.commit();
      console.log(`✅ Bundle ${bundle.bundleId} applied successfully with ${acks.length} steps`);
      
      return acks;
      
    } catch (error) {
      console.error(`❌ Bundle ${bundle.bundleId} transaction failed:`, error);
      throw error;
    }
  }

  /**
   * Batch operation helpers for bundle transactions
   */
  private async batchCreateAssignment(batch: any, payload: any): Promise<void> {
    if (!payload || !payload.assignmentId) {
      throw new Error('Invalid assignment payload: missing assignmentId');
    }
    
    console.log('📄 Batching assignment creation:', payload.assignmentId);
    const assignmentRef = doc(FirebaseFirestore, this.getOrgCollection('assignments'), payload.assignmentId);
    batch.set(assignmentRef, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  private async batchCreateCharge(batch: any, payload: any): Promise<void> {
    if (!payload || !payload.id || !payload.playerId) {
      throw new Error('Invalid charge payload: missing id or playerId');
    }
    
    console.log('💰 Batching charge creation:', payload.id);
    const chargeRef = doc(FirebaseFirestore, this.getOrgCollection('charges'), payload.id);
    batch.set(chargeRef, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  private async batchUpdateCharge(batch: any, payload: any): Promise<void> {
    if (!payload || !payload.chargeId) {
      throw new Error('Invalid charge update payload: missing chargeId');
    }
    
    console.log('💰 Batching charge update:', payload.chargeId);
    const chargeRef = doc(FirebaseFirestore, this.getOrgCollection('charges'), payload.chargeId);
    
    // Remove chargeId from updates and add updatedAt
    const { chargeId, ...updates } = payload.updates || payload;
    batch.update(chargeRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });
  }

  private async batchDeleteCharge(batch: any, payload: any): Promise<void> {
    if (!payload || !payload.chargeId) {
      throw new Error('Invalid charge delete payload: missing chargeId');
    }
    
    console.log('💰 Batching charge deletion:', payload.chargeId);
    const chargeRef = doc(FirebaseFirestore, this.getOrgCollection('charges'), payload.chargeId);
    batch.delete(chargeRef);
  }

  private async batchAppendStockDelta(batch: any, payload: any): Promise<void> {
    if (!payload || !payload.productId || payload.delta === undefined) {
      throw new Error('Invalid stock delta payload: missing productId or delta');
    }
    
    console.log('📦 Batching stock delta:', { productId: payload.productId, delta: payload.delta });
    
    // Append to stock deltas subcollection and update materialized stock
    const productRef = doc(FirebaseFirestore, this.getOrgCollection('products'), payload.productId);
    const deltaRef = doc(FirebaseFirestore, `${this.getOrgCollection('products')}/${payload.productId}/stockDeltas`, generateUUID());
    
    batch.set(deltaRef, {
      delta: payload.delta,
      appliedAt: serverTimestamp(),
      source: 'sale'
    });

    // Update materialized stock (this is a simplified approach)
    batch.update(productRef, {
      stock: increment(payload.delta),
      updatedAt: serverTimestamp()
    });
  }

  private async batchAppendBalanceDelta(batch: any, payload: any, bundleType?: string): Promise<void> {
    if (!payload || !payload.playerId || payload.delta === undefined) {
      throw new Error('Invalid balance delta payload: missing playerId or delta');
    }
    
    console.log('👤 Batching balance delta:', { playerId: payload.playerId, delta: payload.delta, bundleType });
    
    // Append to balance deltas subcollection and update materialized balance
    const playerRef = doc(FirebaseFirestore, this.getOrgCollection('players'), payload.playerId);
    const deltaRef = doc(FirebaseFirestore, `${this.getOrgCollection('players')}/${payload.playerId}/balanceDeltas`, generateUUID());
    
    // Determine source based on bundle type
    const source = bundleType === 'charge' ? 'charge' : 'assignment';
    
    batch.set(deltaRef, {
      delta: payload.delta,
      appliedAt: serverTimestamp(),
      source: source
    });

    // Update materialized balance and purchase stats (only for purchases, not charges)
    const updateData: any = {
      balance: increment(payload.delta),
      updatedAt: serverTimestamp()
    };
    
    // Only increment totalSpent and totalPurchases for actual purchases (not charges)
    const isPurchase = bundleType !== 'charge';
    if (isPurchase && payload.delta > 0) {
      updateData.totalSpent = increment(payload.delta);
      updateData.totalPurchases = increment(1);
      console.log('👤 PURCHASE: Incrementing server totalSpent and totalPurchases');
    } else {
      console.log('👤 CHARGE/PAYMENT: Not incrementing server totalSpent/totalPurchases');
    }
    
    batch.update(playerRef, updateData);
  }

  private async batchApplyStockTakeRebase(batch: any, payload: any): Promise<void> {
    // Apply stock-take with rebase logic (from MD)
    const productRef = doc(FirebaseFirestore, this.getOrgCollection('products'), payload.productId);
    
    // This would implement the rebase algorithm from the MD
    // For now, just set the absolute count
    batch.update(productRef, {
      stock: payload.count,
      lastStockTake: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  private async batchUpdateAssignment(batch: any, assignment: any): Promise<void> {
    if (!assignment || !assignment.assignmentId) {
      throw new Error('Invalid assignment update: missing assignmentId');
    }
    
    console.log('💰 Batching assignment update:', { 
      assignmentId: assignment.assignmentId, 
      updates: assignment 
    });
    
    const assignmentRef = doc(FirebaseFirestore, this.getOrgCollection('assignments'), assignment.assignmentId);
    
    // Create update object excluding the assignmentId
    const { assignmentId, ...updates } = assignment;
    
    batch.update(assignmentRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });
  }

  private async batchUpdateOrganization(batch: any, organizationUpdates: any): Promise<void> {
    if (!organizationUpdates || Object.keys(organizationUpdates).length === 0) {
      throw new Error('Invalid organization update: no updates provided');
    }
    
    console.log('🏢 Batching organization settings update:', { 
      updates: organizationUpdates 
    });
    
    // Store organization settings in orgSettings collection at same level as players/products
    const orgSettingsRef = doc(FirebaseFirestore, this.getOrgCollection('orgSettings'), 'settings');
    
    // Use set with merge to create document if it doesn't exist
    // The bundle system should provide all necessary fields
    batch.set(orgSettingsRef, {
      organizationId: this.organizationId,
      ...organizationUpdates,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp() // Will only be set if document doesn't exist
    }, { merge: true });
  }

  // Products Service
  async getProducts(): Promise<Product[]> {
    try {
      const productsRef = collection(FirebaseFirestore, this.getOrgCollection('products'));
      const q = query(productsRef, where('isActive', '==', true), orderBy('name'));
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];
    } catch (error) {
      console.error('Error getting products:', error);
      throw error;
    }
  }

  async addProduct(product: Product): Promise<string> {
    try {
      // Use logical ID as document ID for consistency
      const productDocRef = doc(FirebaseFirestore, this.getOrgCollection('products'), product.id);
      
      console.log('🔥 FIREBASE - Adding product with logical ID as document ID:', {
        logicalId: product.id,
        name: product.name,
        stock: product.stock
      });
      
      await setDoc(productDocRef, {
        ...product,
        organizationId: this.organizationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ FIREBASE - Product added with consistent ID:', {
        logicalId: product.id,
        documentId: product.id,
        name: product.name
      });
      
      // Return the logical ID (not Firebase document ID)
      return product.id;
    } catch (error) {
      console.error('Error adding product:', error);
      throw error;
    }
  }

  async updateProduct(id: string, updates: Partial<Product>): Promise<void> {
    try {
      console.log('🔍 FIREBASE - Looking for product with logical ID:', id);
      
      // First, find the document by logical ID (not Firebase document ID)
      const productsRef = collection(FirebaseFirestore, this.getOrgCollection('products'));
      const q = query(productsRef, where('id', '==', id));
      const snapshot = await getDocs(q);
      
      console.log('🔍 FIREBASE - Query results:', {
        queryPath: this.getOrgCollection('products'),
        searchingForId: id,
        documentsFound: snapshot.size,
        isEmpty: snapshot.empty
      });
      
      if (snapshot.empty) {
        // Let's also try to list all products to debug
        console.log('🔍 FIREBASE - No product found, listing all products for debugging...');
        const allProductsSnapshot = await getDocs(productsRef);
        const allProducts = allProductsSnapshot.docs.map(doc => ({
          firebaseId: doc.id,
          data: doc.data()
        }));
        console.log('🔍 FIREBASE - All products in collection:', allProducts);
        
        throw new Error(`Product with logical ID ${id} not found. Found ${allProductsSnapshot.size} total products.`);
      }
      
      // Update the first matching document (should only be one)
      const docRef = snapshot.docs[0].ref;
      const foundProduct = snapshot.docs[0].data();
      
      console.log('✅ FIREBASE - Found product to update:', {
        firebaseDocId: snapshot.docs[0].id,
        logicalId: foundProduct.id,
        currentData: foundProduct,
        updates: updates
      });
      
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ Product updated by logical ID:', id);
    } catch (error) {
      console.error('❌ Error updating product by logical ID:', error);
      throw error;
    }
  }

  async deleteProduct(id: string): Promise<void> {
    try {
      // First, find the document by logical ID (not Firebase document ID)
      const productsRef = collection(FirebaseFirestore, this.getOrgCollection('products'));
      const q = query(productsRef, where('id', '==', id));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        throw new Error(`Product with logical ID ${id} not found`);
      }
      
      // Update the first matching document (should only be one)
      const docRef = snapshot.docs[0].ref;
      await updateDoc(docRef, {
        isActive: false,
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ Product deleted by logical ID:', id);
    } catch (error) {
      console.error('Error deleting product by logical ID:', error);
      throw error;
    }
  }

  // Staff Users Service (app operators)
  async getStaffUsers(): Promise<StaffUser[]> {
    try {
      const usersRef = collection(FirebaseFirestore, this.getOrgCollection('staff-users'));
      const q = query(usersRef, where('isActive', '==', true), orderBy('displayName'));
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as StaffUser[];
    } catch (error) {
      console.error('Error getting users:', error);
      throw error;
    }
  }

  async addStaffUser(user: Omit<StaffUser, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const usersRef = collection(FirebaseFirestore, this.getOrgCollection('staff-users'));
      const docRef = await addDoc(usersRef, {
        ...user,
        organizationId: this.organizationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error adding user:', error);
      throw error;
    }
  }

  async updateStaffUser(id: string, updates: Partial<StaffUser>): Promise<void> {
    try {
      const userRef = doc(FirebaseFirestore, this.getOrgCollection('staff-users'), id);
      await updateDoc(userRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async deleteStaffUser(id: string): Promise<void> {
    try {
      console.log('🗑️ STAFF USER DELETE - Deleting staff user with ID:', id);
      const userRef = doc(FirebaseFirestore, this.getOrgCollection('staff-users'), id);
      await deleteDoc(userRef);
      console.log('✅ Staff user deleted successfully');
    } catch (error) {
      console.error('❌ Error deleting staff user:', error);
      throw error;
    }
  }

  // Backward compatibility methods (will be deprecated)
  async getUsers(): Promise<Player[]> {
    return this.getPlayers();
  }

  async addUser(user: { name: string }): Promise<string> {
    const player: Omit<Player, 'id' | 'createdAt' | 'updatedAt'> = {
      name: user.name,
      firstName: user.name.split(' ')[0] || user.name,
      lastName: user.name.split(' ').slice(1).join(' ') || '',
      balance: 0,
      totalPurchases: 0,
      totalSpent: 0,
      isActive: true,
      organizationId: this.organizationId
    };
    return this.addPlayer(player);
  }

  async updateUser(userId: string, updates: any): Promise<void> {
    return this.updatePlayer(userId, updates);
  }

  async deleteUser(playerId: string): Promise<void> {
    return this.updatePlayer(playerId, { isActive: false });
  }

  // Players Service (customers/students) 
  async getPlayers(): Promise<Player[]> {
    try {
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const q = query(playersRef, where('isActive', '==', true), orderBy('name'));
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          // CRITICAL: Preserve UUID id if it exists in data, otherwise fall back to Firebase doc ID
          id: data.id || doc.id,
          firebaseDocId: doc.id  // Keep Firebase doc ID for updates
        } as any;
      }) as Player[];
    } catch (error) {
      console.error('Error getting players:', error);
      throw error;
    }
  }

  async getPlayerById(id: string): Promise<Player | null> {
    try {
      const playerRef = doc(FirebaseFirestore, this.getOrgCollection('players'), id);
      const playerDoc = await getDoc(playerRef);
      
      if (playerDoc.exists()) {
        return {
          id: playerDoc.id,
          ...playerDoc.data()
        } as Player;
      }
      return null;
    } catch (error) {
      console.error('Error getting player:', error);
      throw error;
    }
  }

  async addPlayer(player: any): Promise<string> {
    try {
      console.log('🔥 FirebaseService.addPlayer - Input data:', player);
      
      // Check for duplicate names and auto-number if needed
      const proposedName = player.name || `${player.firstName} ${player.lastName}`.trim();
      const uniqueName = await this.ensureUniqueName(proposedName);
      
      console.log('🔍 Name uniqueness check:', {
        originalName: proposedName,
        finalName: uniqueName,
        wasModified: proposedName !== uniqueName
      });
      
      // CRITICAL: Preserve the UUID id field and use unique name
      const playerData = {
        ...player,
        name: uniqueName, // Use the unique name
        organizationId: this.organizationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      console.log('🔥 FirebaseService.addPlayer - Data for Firebase:', playerData);
      
      // Use logical ID as document ID for consistency
      const playerDocRef = doc(FirebaseFirestore, this.getOrgCollection('players'), player.id);
      await setDoc(playerDocRef, playerData);
      
      console.log('🔥 FirebaseService.addPlayer - Success:', {
        documentId: player.id,
        logicalId: player.id,
        playerName: player.name || `${player.firstName} ${player.lastName}`
      });
      
      // Return the logical UUID (not Firebase document ID)
      return player.id;
    } catch (error) {
      console.error('❌ FirebaseService.addPlayer - Error:', error);
      throw error;
    }
  }

  /**
   * Ensure player name is unique by adding numbers if needed
   * e.g., "Steven Williams" -> "Steven Williams (2)" if duplicate exists
   */
  private async ensureUniqueName(proposedName: string): Promise<string> {
    try {
      const existingPlayers = await this.getPlayers();
      const existingNames = existingPlayers.map(p => p.name?.toLowerCase() || '');
      
      let uniqueName = proposedName;
      let counter = 2;
      
      // Keep incrementing until we find a unique name
      while (existingNames.includes(uniqueName.toLowerCase())) {
        uniqueName = `${proposedName} (${counter})`;
        counter++;
      }
      
      return uniqueName;
    } catch (error) {
      console.warn('⚠️ Could not check for duplicate names, using original:', error);
      return proposedName;
    }
  }

  async updatePlayer(id: string, updates: Partial<Player>): Promise<void> {
    try {
      // First, find the document by logical ID (not Firebase document ID)
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const q = query(playersRef, where('id', '==', id));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        throw new Error(`Player with logical ID ${id} not found`);
      }
      
      // Ensure name field consistency when firstName or lastName is updated
      const updateData = { ...updates };
      if (updates.firstName !== undefined || updates.lastName !== undefined) {
        // Get current player data to build complete name
        const currentData = snapshot.docs[0].data();
        const firstName = updates.firstName !== undefined ? updates.firstName : currentData.firstName || '';
        const lastName = updates.lastName !== undefined ? updates.lastName : currentData.lastName || '';
        updateData.name = `${firstName} ${lastName}`.trim();
      }
      
      // Update the first matching document (should only be one)
      const docRef = snapshot.docs[0].ref;
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ Player updated by logical ID:', id);
    } catch (error) {
      console.error('Error updating player by logical ID:', error);
      throw error;
    }
  }

  async updatePlayerBalance(playerId: string, amount: number, isDebit: boolean = true, isPurchase: boolean = true): Promise<void> {
    try {
      console.log('💰 PLAYER BALANCE UPDATE - Finding player by logical ID:', playerId);
      
      // First, find the document by logical ID (not Firebase document ID)
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const q = query(playersRef, where('id', '==', playerId));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        console.error('❌ Player not found for balance update:', {
          searchingForId: playerId,
          queryPath: this.getOrgCollection('players')
        });
        throw new Error(`Player with logical ID ${playerId} not found`);
      }

      const playerDoc = snapshot.docs[0];
      const player = playerDoc.data() as Player;
      const currentBalance = player.balance || 0;
      
      // For debt tracking: isDebit=true means adding debt (purchase), isDebit=false means payment (reducing debt)
      const newBalance = isDebit ? currentBalance + amount : Math.max(0, currentBalance - amount);
      
      console.log('💰 Updating player balance:', {
        playerId: playerId,
        playerName: player.name || `${player.firstName} ${player.lastName}`,
        currentBalance,
        amount,
        isDebit,
        isPurchase,
        newBalance,
        firebaseDocId: playerDoc.id
      });
      
      // Only increment totalSpent and totalPurchases for actual purchases, not charges
      const updateData: any = {
        balance: newBalance,
        updatedAt: serverTimestamp()
      };
      
      if (isPurchase && isDebit) {
        updateData.totalSpent = (player.totalSpent || 0) + amount;
        updateData.totalPurchases = (player.totalPurchases || 0) + 1;
        console.log('💰 PURCHASE: Incrementing totalSpent and totalPurchases');
      } else {
        console.log('💰 CHARGE/PAYMENT: Not incrementing totalSpent/totalPurchases');
      }
      
      await updateDoc(playerDoc.ref, updateData);
      
      console.log('✅ Player balance updated successfully');
    } catch (error) {
      console.error('❌ Error updating player balance:', error);
      throw error;
    }
  }

  async deletePlayer(playerId: string): Promise<void> {
    try {
      console.log('🗑️ PLAYER DELETE - Finding player by logical ID:', playerId);
      
      // First, find the document by logical ID (not Firebase document ID)
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const q = query(playersRef, where('id', '==', playerId));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        console.error('❌ Player not found for deletion:', {
          searchingForId: playerId,
          queryPath: this.getOrgCollection('players')
        });
        throw new Error(`Player with logical ID ${playerId} not found`);
      }

      const playerDoc = snapshot.docs[0];
      const player = playerDoc.data() as Player;
      
      console.log('🗑️ Deleting player:', {
        playerId: playerId,
        playerName: player.name || `${player.firstName} ${player.lastName}`,
        firebaseDocId: playerDoc.id
      });
      
      await deleteDoc(playerDoc.ref);
      
      console.log('✅ Player deleted successfully');
    } catch (error) {
      console.error('❌ Error deleting player:', error);
      throw error;
    }
  }

  // Assignments Service
  async getAssignments(): Promise<Assignment[]> {
    try {
      const assignmentsRef = collection(FirebaseFirestore, this.getOrgCollection('assignments'));
      const q = query(assignmentsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => {
        const data = doc.data();
        // Validate and ensure totalAmount is a valid number
        const totalAmount = typeof data.totalAmount === 'number' && !isNaN(data.totalAmount) ? data.totalAmount : 0;
        
        return {
          id: doc.id,
          ...data,
          totalAmount,
        };
      }) as Assignment[];
    } catch (error) {
      console.error('Error getting assignments:', error);
      throw error;
    }
  }

  async addAssignment(assignment: any): Promise<string> {
    try {
      console.log('🔥 FIREBASE - Adding assignment with logical ID as document ID:', {
        logicalId: assignment.id,
        productId: assignment.productId,
        playerId: assignment.playerId
      });
      
      // Use logical ID as document ID for consistency
      const assignmentDocRef = doc(FirebaseFirestore, this.getOrgCollection('assignments'), assignment.id);
      await setDoc(assignmentDocRef, {
        ...assignment,
        organizationId: this.organizationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Update player balance and statistics when a purchase is made
      const assignmentData = assignment as any; // Cast to access runtime properties
      if (assignmentData.userName && assignmentData.total) {
        try {
          // Find the player - comprehensive matching with improved logic
          const players = await this.getPlayers();
          
          console.log('🔍 PLAYER MATCHING DEBUG - Looking for player:', {
            assignmentUserName: assignmentData.userName,
            availablePlayers: players.map(p => ({
              id: p.id,
              name: p.name,
              firstName: p.firstName,
              lastName: p.lastName,
              fullName: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
              assignedUserEmail: p.assignedUserEmail
            }))
          });
          
          // SIMPLIFIED PLAYER MATCHING - Only match by exact name
          const player = players.find((p: any) => {
            // Create consistent name format for matching
            const playerFullName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
            const playerName = p.name || playerFullName;
            
            console.log(`🔍 Checking player ${p.id}:`, {
              playerId: p.id,
              playerName,
              playerFullName,
              pName: p.name,
              assignmentUserName: assignmentData.userName,
              exactNameMatch: p.name === assignmentData.userName,
              fullNameMatch: playerFullName === assignmentData.userName
            });
            
            // ONLY match by exact name - no other criteria
            const isMatch = p.name === assignmentData.userName;
            
            if (isMatch) {
              console.log('✅ EXACT PLAYER MATCH FOUND:', { 
                playerId: p.id,
                playerName: p.name,
                assignmentUserName: assignmentData.userName
              });
            }
            
            return isMatch;
          });
          
          console.log('🔍 Player matching result:', {
            assignmentUserName: assignmentData.userName,
            foundPlayer: player ? `${player.firstName} ${player.lastName}` : 'None',
            playerId: player?.id || 'None',
            totalPlayers: players.length
          });
          
          // REMOVED: Balance updates are now handled by dedicated balanceDelta operations in bundle system
          // The bundle creates separate updateBalance operations that are processed in the sync queue
          console.log('💰 Balance update will be handled by bundle balanceDelta operation');
          
          if (!player || !player.id) {
            console.warn('⚠️ No player found for assignment:', {
              userName: assignmentData.userName,
              availablePlayers: players.map(p => ({ name: p.name, fullName: `${p.firstName} ${p.lastName}`, id: p.id }))
            });
          }
        } catch (balanceError) {
          console.error('Error updating player balance for assignment:', balanceError);
          // Don't throw here - the assignment was created successfully
        }
      }

      console.log('✅ FIREBASE - Assignment added with consistent ID:', {
        logicalId: assignment.id,
        documentId: assignment.id
      });
      
      // Return the logical ID (not Firebase document ID)
      return assignment.id;
    } catch (error) {
      console.error('Error adding assignment:', error);
      throw error;
    }
  }

  async updateAssignment(id: string, updates: Partial<Assignment>): Promise<void> {
    try {
      // First, find the document by assignmentId (not Firebase document ID)
      const assignmentsRef = collection(FirebaseFirestore, this.getOrgCollection('assignments'));
      const q = query(assignmentsRef, where('assignmentId', '==', id));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        throw new Error(`Assignment with logical ID ${id} not found`);
      }
      
      // Update the first matching document (should only be one)
      const docRef = snapshot.docs[0].ref;
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ Assignment updated by logical ID:', id);
    } catch (error) {
      console.error('Error updating assignment by logical ID:', error);
      throw error;
    }
  }

  async deleteAssignment(id: string): Promise<void> {
    try {
      // Find the document by assignmentId (not Firebase document ID)
      const assignmentsRef = collection(FirebaseFirestore, this.getOrgCollection('assignments'));
      const q = query(assignmentsRef, where('assignmentId', '==', id));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        throw new Error(`Assignment with logical ID ${id} not found`);
      }
      
      // Delete the first matching document (should only be one)
      const docRef = snapshot.docs[0].ref;
      await deleteDoc(docRef);
      
      console.log('✅ Assignment deleted by logical ID:', id);
    } catch (error) {
      console.error('Error deleting assignment by logical ID:', error);
      throw error;
    }
  }

  // Charges Service
  async getCharges(): Promise<any[]> {
    try {
      const chargesRef = collection(FirebaseFirestore, this.getOrgCollection('charges'));
      const q = query(chargesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (error) {
      console.error('Error getting charges:', error);
      throw error;
    }
  }

  async deleteCharge(id: string): Promise<void> {
    try {
      const chargeRef = doc(FirebaseFirestore, this.getOrgCollection('charges'), id);
      await deleteDoc(chargeRef);
      console.log('✅ Charge deleted:', id);
    } catch (error) {
      console.error('Error deleting charge:', error);
      throw error;
    }
  }

  async clearPlayerBalanceDeltas(playerId: string): Promise<void> {
    try {
      console.log('🧹 Clearing balance deltas for player:', playerId);
      
      // Find the player document
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const q = query(playersRef, where('id', '==', playerId));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        console.warn(`⚠️ Player ${playerId} not found, skipping balance deltas cleanup`);
        return;
      }
      
      const playerDocRef = snapshot.docs[0].ref;
      
      // Delete the entire balanceDeltas subcollection
      const balanceDeltasRef = collection(playerDocRef, 'balanceDeltas');
      const deltasSnapshot = await getDocs(balanceDeltasRef);
      
      console.log(`🧹 Found ${deltasSnapshot.docs.length} balance delta records to delete`);
      
      // Delete all balance delta documents
      const batch = writeBatch(FirebaseFirestore);
      deltasSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      console.log(`✅ Cleared ${deltasSnapshot.docs.length} balance deltas for player ${playerId}`);
    } catch (error) {
      console.error('Error clearing player balance deltas:', error);
      throw error;
    }
  }

  async forceResetPlayerBalance(playerId: string): Promise<void> {
    try {
      console.log('💰 Force resetting player balance to zero:', playerId);
      
      // Find the player document
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const q = query(playersRef, where('id', '==', playerId));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        console.warn(`⚠️ Player ${playerId} not found, skipping balance reset`);
        return;
      }
      
      const playerDocRef = snapshot.docs[0].ref;
      
      // Force set balance to exactly zero (don't use increment logic)
      await updateDoc(playerDocRef, {
        balance: 0,
        totalSpent: 0,
        totalPurchases: 0,
        lastPurchaseDate: null,
        updatedAt: serverTimestamp()
      });
      
      console.log(`✅ Force reset player balance to zero: ${playerId}`);
    } catch (error) {
      console.error('Error force resetting player balance:', error);
      throw error;
    }
  }

  // Reports Service
  async getReports(): Promise<Report[]> {
    try {
      const reportsRef = collection(FirebaseFirestore, this.getOrgCollection('reports'));
      const q = query(reportsRef, orderBy('createdAt', 'desc'), limit(50));
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Report[];
    } catch (error) {
      console.error('Error getting reports:', error);
      throw error;
    }
  }

  async addReport(report: Omit<Report, 'id' | 'createdAt'>): Promise<string> {
    try {
      const reportsRef = collection(FirebaseFirestore, this.getOrgCollection('reports'));
      const docRef = await addDoc(reportsRef, {
        ...report,
        organizationId: this.organizationId,
        createdAt: serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error adding report:', error);
      throw error;
    }
  }

  // Real-time listeners
  subscribeToProducts(callback: (products: Product[]) => void) {
    const productsRef = collection(FirebaseFirestore, this.getOrgCollection('products'));
    const q = query(productsRef, where('isActive', '==', true), orderBy('name'));
    
    return onSnapshot(q, (snapshot) => {
      const products = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];
      callback(products);
    });
  }

  subscribeToUsers(callback: (users: User[]) => void) {
    const usersRef = collection(FirebaseFirestore, this.getOrgCollection('users'));
    const q = query(usersRef, where('isActive', '==', true), orderBy('displayName'));
    
    return onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as User[];
      callback(users);
    });
  }

  subscribeToAssignments(callback: (assignments: Assignment[]) => void) {
    const assignmentsRef = collection(FirebaseFirestore, this.getOrgCollection('assignments'));
    const q = query(assignmentsRef, orderBy('createdAt', 'desc'));
    
    return onSnapshot(q, (snapshot) => {
      const assignments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Assignment[];
      callback(assignments);
    });
  }

  // Batch operations for data migration
  async migrateData(data: {
    products?: Product[];
    users?: User[];
    assignments?: Assignment[];
    reports?: Report[];
  }): Promise<void> {
    const batch = writeBatch(FirebaseFirestore);

    try {
      // Migrate products
      if (data.products) {
        const productsRef = collection(FirebaseFirestore, this.getOrgCollection('products'));
        data.products.forEach(product => {
          const docRef = doc(productsRef);
          batch.set(docRef, {
            ...product,
            organizationId: this.organizationId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
      }

      // Migrate users
      if (data.users) {
        const usersRef = collection(FirebaseFirestore, this.getOrgCollection('users'));
        data.users.forEach(user => {
          const docRef = doc(usersRef);
          batch.set(docRef, {
            ...user,
            organizationId: this.organizationId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
      }

      // Migrate assignments
      if (data.assignments) {
        const assignmentsRef = collection(FirebaseFirestore, this.getOrgCollection('assignments'));
        data.assignments.forEach(assignment => {
          const docRef = doc(assignmentsRef);
          batch.set(docRef, {
            ...assignment,
            organizationId: this.organizationId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
      }

      // Migrate reports
      if (data.reports) {
        const reportsRef = collection(FirebaseFirestore, this.getOrgCollection('reports'));
        data.reports.forEach(report => {
          const docRef = doc(reportsRef);
          batch.set(docRef, {
            ...report,
            organizationId: this.organizationId,
            createdAt: serverTimestamp()
          });
        });
      }

      await batch.commit();
      console.log('Data migration completed successfully');
    } catch (error) {
      console.error('Error migrating data:', error);
      throw error;
    }
  }

  // Sync all player balances based on existing assignments
  async syncAllPlayerBalances(): Promise<void> {
    try {
      console.log('🔄 Starting player balance sync...');
      
      // Get all players and assignments
      const [players, assignments] = await Promise.all([
        this.getPlayers(),
        this.getAssignments()
      ]);

      console.log(`📊 Found ${players.length} players and ${assignments.length} assignments`);

      // Calculate balances for each player
      for (const player of players) {
        if (!player.id) continue;

        // Find all assignments for this player - comprehensive matching
        const playerAssignments = assignments.filter((assignment: any) => {
          // Direct player name match
          if (assignment.userName === player.name || assignment.playerName === player.name) {
            return true;
          }
          
          // If player is assigned to an auth user, match assignments made by that user
          if (player.assignedUserEmail) {
            // Match by assigned user email
            if (assignment.userName === player.assignedUserEmail) {
              return true;
            }
            
            // Match by assigned user ID (if available)
            if (player.assignedUserId && assignment.userId === player.assignedUserId) {
              return true;
            }
            
            // Match by createdByUserName or createdByUserId (for newer assignment structure)
            if (assignment.createdByUserName === player.assignedUserEmail || 
                assignment.createdByUserId === player.assignedUserId) {
              return true;
            }
          }
          
          return false;
        });

        // Calculate total debt and statistics
        let totalOwed = 0;
        let totalPurchases = 0;
        let totalSpent = 0;

        for (const assignment of playerAssignments) {
          const assignmentData = assignment as any; // Cast to access all possible properties
          const amount = assignmentData.total || assignmentData.totalAmount || 0;
          if (!assignmentData.paid && amount > 0) {
            totalOwed += amount; // Only unpaid items contribute to debt
          }
          if (amount > 0) {
            totalPurchases += 1;
            totalSpent += amount;
          }
        }

        // Update player with calculated values
        const playerRef = doc(FirebaseFirestore, this.getOrgCollection('players'), player.id);
        await updateDoc(playerRef, {
          balance: totalOwed, // Debt owed
          totalPurchases: totalPurchases,
          totalSpent: totalSpent,
          updatedAt: serverTimestamp()
        });

        console.log(`✅ Updated ${player.name}${player.assignedUserEmail ? ` (assigned to ${player.assignedUserEmail})` : ''}: ${playerAssignments.length} assignments, owes ${formatCurrency(totalOwed, 'GBP')}`);
        
        // Debug: Show assignment details for troubleshooting
        if (playerAssignments.length > 0) {
          console.log(`   📋 Assignments: ${playerAssignments.map((a: any) => `${a.productName || a.userName || 'Unknown'} (${formatCurrency((a.total || a.totalAmount || 0), 'GBP')})`).join(', ')}`);
        }
      }

      console.log('✅ Player balance sync completed');
    } catch (error) {
      console.error('❌ Error syncing player balances:', error);
      throw error;
    }
  }

  // Sync balance for a single player (optimized for individual transactions)
  async syncSinglePlayerBalance(playerId: string): Promise<void> {
    try {
      console.log(`🎯 Starting single player balance sync for ID: ${playerId}`);
      
      // Get all players and assignments, then find the specific player
      const [players, assignments] = await Promise.all([
        this.getPlayers(),
        this.getAssignments()
      ]);

      const player = players.find(p => p.id === playerId);
      if (!player || !player.id) {
        throw new Error(`Player not found with ID: ${playerId}`);
      }

      console.log(`📊 Found player: ${player.name}, checking ${assignments.length} total assignments`);

      // Find all assignments for this specific player
      const playerAssignments = assignments.filter((assignment: any) => {
        // Direct player name match
        if (assignment.userName === player.name || assignment.playerName === player.name) {
          return true;
        }
        
        // If player is assigned to an auth user, match assignments made by that user
        if (player.assignedUserEmail) {
          // Match by assigned user email
          if (assignment.userName === player.assignedUserEmail) {
            return true;
          }
          
          // Match by assigned user ID (if available)
          if (player.assignedUserId && assignment.userId === player.assignedUserId) {
            return true;
          }
          
          // Match by createdByUserName or createdByUserId (for newer assignment structure)
          if (assignment.createdByUserName === player.assignedUserEmail || 
              assignment.createdByUserId === player.assignedUserId) {
            return true;
          }
        }
        
        return false;
      });

      // Calculate total debt and statistics
      let totalOwed = 0;
      let totalPurchases = 0;
      let totalSpent = 0;

      for (const assignment of playerAssignments) {
        const assignmentData = assignment as any;
        const amount = assignmentData.total || assignmentData.totalAmount || 0;
        if (!assignmentData.paid && amount > 0) {
          totalOwed += amount; // Only unpaid items contribute to debt
        }
        if (amount > 0) {
          totalPurchases += 1;
          totalSpent += amount;
        }
      }

      // Update player with calculated values
      const playerRef = doc(FirebaseFirestore, this.getOrgCollection('players'), player.id);
      await updateDoc(playerRef, {
        balance: totalOwed,
        totalPurchases: totalPurchases,
        totalSpent: totalSpent,
        updatedAt: serverTimestamp()
      });

      console.log(`✅ Updated ${player.name}: ${playerAssignments.length} assignments, owes ${formatCurrency(totalOwed, 'GBP')}`);
      
      if (playerAssignments.length > 0) {
        console.log(`   📋 Assignments: ${playerAssignments.map((a: any) => `${a.productName || a.userName || 'Unknown'} (${formatCurrency((a.total || a.totalAmount || 0), 'GBP')})`).join(', ')}`);
      }
    } catch (error) {
      console.error(`❌ Error syncing single player balance for ${playerId}:`, error);
      throw error;
    }
  }

  // Reset methods for complete data cleanup
  async resetAllData() {
    try {
      console.log('🔄 Starting complete Firebase data reset...');
      
      // Delete all assignments
      const assignmentsRef = collection(FirebaseFirestore, this.getOrgCollection('assignments'));
      const assignmentSnapshots = await getDocs(assignmentsRef);
      
      console.log(`📋 Deleting ${assignmentSnapshots.size} assignments...`);
      const assignmentDeletes = assignmentSnapshots.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(assignmentDeletes);
      
      // Delete all players
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const playerSnapshots = await getDocs(playersRef);
      
      console.log(`👥 Deleting ${playerSnapshots.size} players...`);
      const playerDeletes = playerSnapshots.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(playerDeletes);
      
      // Delete all products
      const productsRef = collection(FirebaseFirestore, this.getOrgCollection('products'));
      const productSnapshots = await getDocs(productsRef);
      
      console.log(`📦 Deleting ${productSnapshots.size} products...`);
      const productDeletes = productSnapshots.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(productDeletes);
      
      // Delete all reports
      const reportsRef = collection(FirebaseFirestore, this.getOrgCollection('reports'));
      const reportSnapshots = await getDocs(reportsRef);
      
      console.log(`📊 Deleting ${reportSnapshots.size} reports...`);
      const reportDeletes = reportSnapshots.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(reportDeletes);
      
      console.log('✅ Complete Firebase data reset completed');
    } catch (error) {
      console.error('❌ Error resetting Firebase data:', error);
      throw error;
    }
  }

  async resetSalesData() {
    try {
      console.log('🔄 Starting sales data reset...');
      
      // Delete all assignments
      const assignmentsRef = collection(FirebaseFirestore, this.getOrgCollection('assignments'));
      const assignmentSnapshots = await getDocs(assignmentsRef);
      
      console.log(`📋 Deleting ${assignmentSnapshots.size} assignments...`);
      const assignmentDeletes = assignmentSnapshots.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(assignmentDeletes);
      
      // Delete all reports
      const reportsRef = collection(FirebaseFirestore, this.getOrgCollection('reports'));
      const reportSnapshots = await getDocs(reportsRef);
      
      console.log(`📊 Deleting ${reportSnapshots.size} reports...`);
      const reportDeletes = reportSnapshots.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(reportDeletes);
      
      // Reset all player balances to 0
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const playerSnapshots = await getDocs(playersRef);
      
      console.log(`👥 Resetting ${playerSnapshots.size} player balances...`);
      const playerUpdates = playerSnapshots.docs.map(doc => 
        updateDoc(doc.ref, {
          balance: 0,
          totalPurchases: 0,
          totalSpent: 0,
          updatedAt: serverTimestamp()
        })
      );
      await Promise.all(playerUpdates);
      
      console.log('✅ Sales data reset completed');
    } catch (error) {
      console.error('❌ Error resetting sales data:', error);
      throw error;
    }
  }

  // Fix player name consistency for existing players
  async fixPlayerNameConsistency(): Promise<void> {
    try {
      const players = await this.getPlayers();
      
      for (const player of players) {
        if (player.id && player.firstName && player.lastName) {
          const expectedName = `${player.firstName} ${player.lastName}`.trim();
          if (player.name !== expectedName) {
            console.log(`🔧 Fixing name for player ${player.id}: "${player.name}" → "${expectedName}"`);
            await this.updatePlayer(player.id, {
              name: expectedName
            });
          }
        }
      }
      
      console.log('✅ Player name consistency check completed');
    } catch (error) {
      console.error('Error fixing player name consistency:', error);
      throw error;
    }
  }

  // ============================================
  // UPSERT METHODS - Fix for sync issues
  // ============================================

  /**
   * UPSERT: Create document if it doesn't exist, update if it does
   * Uses the logical ID as the document ID for consistency
   */
  async upsertProduct(product: Product): Promise<void> {
    try {
      const productsRef = collection(FirebaseFirestore, this.getOrgCollection('products'));
      const docRef = doc(productsRef, product.id); // Use logical ID as document ID
      
      // Check if document exists
      const docSnap = await getDoc(docRef);
      
      const cleanProduct = {
        ...product,
        organizationId: this.organizationId
      };
      
      if (docSnap.exists()) {
        // Document exists - update
        await updateDoc(docRef, {
          ...cleanProduct,
          updatedAt: serverTimestamp()
        });
        console.log('✅ Product updated in Firebase:', product.id);
      } else {
        // Document doesn't exist - create
        await setDoc(docRef, {
          ...cleanProduct,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        console.log('✅ Product created in Firebase:', product.id);
      }
    } catch (error) {
      console.error('❌ Error upserting product:', error);
      throw error;
    }
  }

  async upsertPlayer(player: any): Promise<void> {
    try {
      const playersRef = collection(FirebaseFirestore, this.getOrgCollection('players'));
      const docRef = doc(playersRef, player.id); // Use logical ID as document ID
      
      // Check if document exists
      const docSnap = await getDoc(docRef);
      
      const cleanPlayer = {
        ...player,
        organizationId: this.organizationId
      };
      
      if (docSnap.exists()) {
        // Document exists - update
        await updateDoc(docRef, {
          ...cleanPlayer,
          updatedAt: serverTimestamp()
        });
        console.log('✅ Player updated in Firebase:', player.id);
      } else {
        // Document doesn't exist - create
        // Ensure unique name for new players
        const uniqueName = await this.ensureUniqueName(cleanPlayer.name);
        await setDoc(docRef, {
          ...cleanPlayer,
          name: uniqueName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        console.log('✅ Player created in Firebase:', player.id);
      }
    } catch (error) {
      console.error('❌ Error upserting player:', error);
      throw error;
    }
  }

  async upsertAssignment(assignment: any): Promise<void> {
    try {
      const assignmentsRef = collection(FirebaseFirestore, this.getOrgCollection('assignments'));
      const docRef = doc(assignmentsRef, assignment.id); // Use logical ID as document ID
      
      // Check if document exists
      const docSnap = await getDoc(docRef);
      
      const cleanAssignment = {
        ...assignment,
        organizationId: this.organizationId
      };
      
      if (docSnap.exists()) {
        // Document exists - update
        await updateDoc(docRef, {
          ...cleanAssignment,
          updatedAt: serverTimestamp()
        });
        console.log('✅ Assignment updated in Firebase:', assignment.id);
      } else {
        // Document doesn't exist - create
        await setDoc(docRef, {
          ...cleanAssignment,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        console.log('✅ Assignment created in Firebase:', assignment.id);
      }
    } catch (error) {
      console.error('❌ Error upserting assignment:', error);
      throw error;  
    }
  }
}

// Create singleton instance
export const firebaseService = new FirebaseService();
export default firebaseService;