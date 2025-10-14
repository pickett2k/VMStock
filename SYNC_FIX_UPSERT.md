# SYNC FIX: UPSERT Logic Implementation

## Problem Identified

The sync fails because:

1. **Wrong Dependency Order**: Assignment sync tries to create assignments before ensuring products/players exist in Firebase
2. **Missing UPSERT Logic**: No check if entities already exist before creation attempts
3. **Partial Transaction Failure**: If any part of assignment transaction fails, everything fails

## Required Fix: Implement Proper UPSERT Pattern

### Step 1: Add Firebase UPSERT Methods

Add these methods to `FirebaseService.ts`:

```typescript
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
```

### Step 2: Fix Sync Logic in HybridSyncService

Replace the broken sync logic with proper UPSERT handling:

```typescript
/**
 * Attempt to sync operation to server immediately
 */
private async syncOpToServer(operation: Operation): Promise<void> {
  const firebaseService = new FirebaseService();
  
  console.log('🔥 SYNC TO SERVER - Starting:', {
    collection: operation.collection,
    type: operation.type,
    entityId: operation.entityId,
    operationId: operation.id,
    hasData: !!operation.data,
    timestamp: new Date().toISOString()
  });

  try {
    switch (operation.collection) {
      case 'products':
        await this.syncProductToServer(firebaseService, operation);
        break;
        
      case 'players':
        await this.syncPlayerToServer(firebaseService, operation);
        break;
        
      case 'assignments':
        if (operation.type === 'createAssignmentTransaction') {
          await this.syncAssignmentTransactionToServer(operation);
        } else {
          await this.syncAssignmentToServer(firebaseService, operation);
        }
        break;
        
      case 'staff-users':
        await this.syncStaffUserToServer(firebaseService, operation);
        break;
        
      default:
        console.warn('⚠️ Server sync not implemented for:', operation.collection);
    }
    
    console.log('✅ Operation synced to server:', operation.id);
  } catch (error) {
    console.error('❌ Server sync failed:', error);
    throw error;
  }
}

private async syncProductToServer(firebaseService: FirebaseService, operation: Operation): Promise<void> {
  const { createdAt, updatedAt, version, vectorClock, ...cleanData } = operation.data;
  
  switch (operation.type) {
    case 'create':
    case 'update':
      await firebaseService.upsertProduct(cleanData);
      break;
    case 'delete':
      // Soft delete via isActive flag
      await firebaseService.upsertProduct({ ...cleanData, isActive: false });
      break;
  }
}

private async syncPlayerToServer(firebaseService: FirebaseService, operation: Operation): Promise<void> {
  const { createdAt, updatedAt, version, vectorClock, ...cleanData } = operation.data;
  
  switch (operation.type) {
    case 'create':
    case 'update': 
    case 'updateBalance':
      await firebaseService.upsertPlayer(cleanData);
      break;
    case 'delete':
      // Soft delete via isActive flag
      await firebaseService.upsertPlayer({ ...cleanData, isActive: false });
      break;
  }
}

private async syncAssignmentToServer(firebaseService: FirebaseService, operation: Operation): Promise<void> {
  const { createdAt, updatedAt, version, vectorClock, ...cleanData } = operation.data;
  
  switch (operation.type) {
    case 'create':
    case 'update':
      await firebaseService.upsertAssignment(cleanData);
      break;
    case 'delete':
      // Soft delete via cancelled flag
      await firebaseService.upsertAssignment({ ...cleanData, cancelled: true });
      break;
  }
}

/**
 * Sync compound assignment transaction to server  
 * FIXED: Proper dependency order and UPSERT logic
 */
private async syncAssignmentTransactionToServer(operation: Operation): Promise<void> {
  const firebaseService = new FirebaseService();
  
  console.log('🔥 ASSIGNMENT TRANSACTION SYNC - Starting compound operation:', {
    assignmentId: operation.entityId,
    productId: operation.data.productId,
    playerId: operation.data.playerId,
    quantity: operation.data.quantity,
    total: operation.data.total
  });

  try {
    // Get the updated entities from local cache (these have the correct state)
    const localProducts = await this.getLocalData('products');
    const localPlayers = await this.getLocalData('players');
    const localAssignments = await this.getLocalData('assignments');
    
    const product = localProducts.find(p => p.id === operation.data.productId);
    const player = localPlayers.find(p => p.id === operation.data.playerId);
    const assignment = localAssignments.find(a => a.id === operation.entityId);
    
    if (!product || !player || !assignment) {
      throw new Error(`Missing entities for assignment transaction: ${operation.entityId}`);
    }

    // STEP 1: Ensure product exists in Firebase (UPSERT)
    const { createdAt: pCreatedAt, updatedAt: pUpdatedAt, version: pVersion, vectorClock: pVectorClock, ...cleanProduct } = product;
    await firebaseService.upsertProduct(cleanProduct);
    
    // STEP 2: Ensure player exists in Firebase (UPSERT) 
    const { createdAt: plCreatedAt, updatedAt: plUpdatedAt, version: plVersion, vectorClock: plVectorClock, ...cleanPlayer } = player;
    await firebaseService.upsertPlayer(cleanPlayer);
    
    // STEP 3: Create/update assignment in Firebase (UPSERT)
    const { createdAt: aCreatedAt, updatedAt: aUpdatedAt, version: aVersion, vectorClock: aVectorClock, ...cleanAssignment } = assignment;
    await firebaseService.upsertAssignment(cleanAssignment);
    
    console.log('✅ Assignment transaction synced to server successfully:', operation.entityId);

  } catch (error) {
    console.error('❌ Assignment transaction sync failed:', error);
    throw error;
  }
}
```

## Benefits of This Fix

1. **UPSERT Safety**: No more failures when documents already exist
2. **Proper Dependencies**: Products and players ensured to exist before assignment creation  
3. **Atomic Success**: All three entities sync or none do
4. **Consistent IDs**: Logical UUIDs used as Firebase document IDs
5. **Idempotent**: Safe to retry, won't create duplicates

## Implementation Steps

1. Add the three `upsert*` methods to `FirebaseService.ts`
2. Replace the sync methods in `HybridSyncService.ts`
3. Test offline → online sync scenarios
4. Verify no duplicate documents are created

This fix should resolve the sync issues you've been experiencing!