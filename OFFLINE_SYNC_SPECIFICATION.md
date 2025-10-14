# VMStock Offline-First Data Specification

## Core Issue Summary

**Problem**: App works perfectly offline and online independently, but **sync fails when connectivity is restored**. The offline operations are not properly syncing to the server.

**Root Cause**: The sync process (applyOp → server) is not correctly handling the offline-created entities and their relationships.

---

## Required Data Structures

### Product Entity (Local Storage & Firebase)

```typescript
interface Product {
  id: string;              // UUID - PRIMARY KEY
  name: string;
  category: string;
  price: number;
  stock: number;
  isActive: boolean;
  organizationId: string;
  createdAt: timestamp;    // ISO string locally, Firestore timestamp on server
  updatedAt: timestamp;    // ISO string locally, Firestore timestamp on server
}
```

**Local Storage Key**: `products`
**Firebase Collection**: `organizations/{orgId}/products`

### Player Entity (Local Storage & Firebase)

```typescript
interface Player {
  id: string;              // UUID - PRIMARY KEY  
  firstName: string;
  lastName: string;
  name: string;            // Computed: firstName + " " + lastName
  balance: number;         // Running debt/credit balance
  totalPurchases: number;  // Count of transactions
  totalSpent: number;      // Lifetime spending amount
  lastPurchaseDate: timestamp | null;
  isActive: boolean;
  organizationId: string;
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

**Local Storage Key**: `players`
**Firebase Collection**: `organizations/{orgId}/players`

### Assignment Entity (Local Storage & Firebase)

```typescript
interface Assignment {
  id: string;              // UUID - PRIMARY KEY
  playerId: string;        // FOREIGN KEY → Player.id
  productId: string;       // FOREIGN KEY → Product.id
  userName: string;        // Denormalized from Player.name
  productName: string;     // Denormalized from Product.name
  quantity: number;
  unitPrice: number;
  total: number;           // quantity * unitPrice
  paid: boolean;
  cancelled: boolean;
  notes: string;
  date: string;            // ISO string
  organizationId: string;
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

**Local Storage Key**: `assignments`
**Firebase Collection**: `organizations/{orgId}/assignments`

---

## CRUD Operations Specification

### CREATE Operations

#### Create Product (Offline-First)

```typescript
// Local storage immediately updated with:
const newProduct = {
  id: generateUUID(),
  name: formData.name,
  category: formData.category,
  price: formData.price,
  stock: formData.stock,
  isActive: true,
  organizationId: currentOrg.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// Sync operation queued:
await applyOp({
  type: 'create',
  collection: 'products',
  entityId: newProduct.id,
  data: newProduct
});
```

#### Create Player (Offline-First)

```typescript
// Local storage immediately updated with:
const newPlayer = {
  id: generateUUID(),
  firstName: formData.firstName,
  lastName: formData.lastName,
  name: `${formData.firstName} ${formData.lastName}`,
  balance: 0,
  totalPurchases: 0,
  totalSpent: 0,
  lastPurchaseDate: null,
  isActive: true,
  organizationId: currentOrg.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// Sync operation queued:
await applyOp({
  type: 'create',
  collection: 'players', 
  entityId: newPlayer.id,
  data: newPlayer
});
```

#### Create Assignment (Compound Transaction)

```typescript
// ATOMIC LOCAL UPDATES:
// 1. Create assignment
const newAssignment = {
  id: generateUUID(),
  playerId: selectedPlayer.id,     // From dropdown selection
  productId: selectedProduct.id,   // From dropdown selection  
  userName: selectedPlayer.name,
  productName: selectedProduct.name,
  quantity: formData.quantity,
  unitPrice: selectedProduct.price,
  total: selectedProduct.price * formData.quantity,
  paid: false,
  cancelled: false,
  notes: formData.notes || 'Sale transaction',
  date: new Date().toISOString(),
  organizationId: currentOrg.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// 2. Update player balance/stats (SAME TRANSACTION)
const updatedPlayer = {
  ...selectedPlayer,
  balance: selectedPlayer.balance + newAssignment.total,
  totalPurchases: selectedPlayer.totalPurchases + newAssignment.quantity,
  totalSpent: selectedPlayer.totalSpent + newAssignment.total,
  lastPurchaseDate: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// 3. Update product stock (SAME TRANSACTION)
const updatedProduct = {
  ...selectedProduct,
  stock: selectedProduct.stock - newAssignment.quantity,
  updatedAt: new Date().toISOString()
};

// All local storage updated atomically, then single sync operation:
await applyOp({
  type: 'createAssignmentTransaction',
  collection: 'assignments',
  entityId: newAssignment.id,
  data: {
    assignment: newAssignment,
    playerUpdate: updatedPlayer,
    productUpdate: updatedProduct
  }
});
```

### UPDATE Operations

#### Update Product

```typescript
// Local storage immediately updated:
const updatedProduct = {
  ...existingProduct,
  ...formData,
  updatedAt: new Date().toISOString()
};

// Sync operation queued:
await applyOp({
  type: 'update',
  collection: 'products',
  entityId: productId,
  data: updatedProduct
});
```

#### Update Player

```typescript
// Local storage immediately updated:
const updatedPlayer = {
  ...existingPlayer,
  ...formData,
  name: `${formData.firstName} ${formData.lastName}`, // Recompute name
  updatedAt: new Date().toISOString()  
};

// Sync operation queued:
await applyOp({
  type: 'update', 
  collection: 'players',
  entityId: playerId,
  data: updatedPlayer
});
```

#### Update Assignment (Mark as Paid)

```typescript
// Local storage immediately updated:
const updatedAssignment = {
  ...existingAssignment,
  paid: true,
  updatedAt: new Date().toISOString()
};

// Sync operation queued:
await applyOp({
  type: 'update',
  collection: 'assignments', 
  entityId: assignmentId,
  data: updatedAssignment
});
```

### DELETE Operations

#### Delete Product

```typescript
// Local storage immediately updated (soft delete):
const deletedProduct = {
  ...existingProduct,
  isActive: false,
  updatedAt: new Date().toISOString()
};

// Sync operation queued:
await applyOp({
  type: 'update', // Soft delete via isActive flag
  collection: 'products',
  entityId: productId, 
  data: deletedProduct
});
```

#### Delete Player

```typescript
// Local storage immediately updated (soft delete):
const deletedPlayer = {
  ...existingPlayer,
  isActive: false,
  updatedAt: new Date().toISOString()
};

// Sync operation queued:
await applyOp({
  type: 'update', // Soft delete via isActive flag
  collection: 'players',
  entityId: playerId,
  data: deletedPlayer
});
```

#### Delete Assignment

```typescript
// Local storage immediately updated (soft delete):
const deletedAssignment = {
  ...existingAssignment,
  cancelled: true,
  updatedAt: new Date().toISOString()
};

// Sync operation queued:
await applyOp({
  type: 'update', // Soft delete via cancelled flag
  collection: 'assignments',
  entityId: assignmentId,
  data: deletedAssignment
};
```

---

## Sync Process Specification

### Server Sync Logic (UPSERT Pattern)

When connectivity is restored, the sync process should handle each queued operation:

```typescript
async syncToServer(operation: Operation): Promise<void> {
  const { collection, entityId, data, type } = operation;
  
  switch (type) {
    case 'create':
    case 'update':
      // UPSERT: Try to update first, create if doesn't exist
      const docExists = await firebaseService.documentExists(collection, entityId);
      
      if (docExists) {
        await firebaseService.updateDocument(collection, entityId, data);
        console.log(`✅ Updated existing ${collection}/${entityId}`);
      } else {
        await firebaseService.createDocument(collection, entityId, data);
        console.log(`✅ Created new ${collection}/${entityId}`);
      }
      break;
      
    case 'createAssignmentTransaction':
      // Compound operation: Create assignment + Update player + Update product
      await this.syncAssignmentTransaction(operation);
      break;
  }
}

async syncAssignmentTransaction(operation: Operation): Promise<void> {
  const { assignment, playerUpdate, productUpdate } = operation.data;
  
  // 1. Create/update assignment
  await this.upsertDocument('assignments', assignment.id, assignment);
  
  // 2. Update player (always exists since created offline first)
  await this.upsertDocument('players', playerUpdate.id, playerUpdate);
  
  // 3. Update product (always exists since selected from dropdown)
  await this.upsertDocument('products', productUpdate.id, productUpdate);
  
  console.log(`✅ Assignment transaction synced: ${assignment.id}`);
}

async upsertDocument(collection: string, entityId: string, data: any): Promise<void> {
  // Clean data: Remove local-only fields
  const { createdAt, updatedAt, ...cleanData } = data;
  
  const docRef = db.collection(`organizations/${orgId}/${collection}`).doc(entityId);
  const doc = await docRef.get();
  
  if (doc.exists) {
    // Update existing document
    await docRef.update({
      ...cleanData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    // Create new document  
    await docRef.set({
      ...cleanData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}
```

---

## Critical Requirements

### 1. ID Consistency
- **Products**: ID from local storage must match Firebase document ID
- **Players**: ID from local storage must match Firebase document ID  
- **Assignments**: `playerId` and `productId` must reference actual entity IDs

### 2. Atomic Transactions
- Assignment creation must update 3 entities atomically (assignment + player + product)
- Local storage updates must complete before sync queuing
- Rollback capability if any part of transaction fails

### 3. Relationship Integrity
- Assignment `playerId` must exist in players collection
- Assignment `productId` must exist in products collection
- Denormalized fields (`userName`, `productName`) must stay in sync

### 4. Sync Safety
- Queued operations must be idempotent (safe to retry)
- Server sync must handle missing dependencies gracefully
- Timestamp-based conflict resolution for concurrent updates

### 5. Error Handling
- Local operations never fail (offline-first)
- Sync failures should queue for retry, not break app
- Network restoration should trigger automatic sync attempt

---

## Current Sync Issues to Fix

Based on your description, the likely problems are:

1. **UPSERT Logic Missing**: Sync assumes documents don't exist, fails when they do
2. **Compound Transaction Handling**: Assignment creation not properly syncing all 3 entities
3. **ID Mismatch**: Local UUIDs not matching Firebase document IDs
4. **Timestamp Conversion**: Local ISO strings not converting to Firestore timestamps
5. **Clean Data Process**: Local-only fields not being stripped before Firebase sync
6. **Relationship Validation**: Server sync not validating `playerId`/`productId` exist

The sync process needs to be **bulletproof UPSERT** with proper relationship handling and atomic transaction support.

---

*This specification defines the exact offline-first behavior required for VMStock to work reliably across offline/online scenarios.*