# VMStock - Complete Offline-First Architecture Guide

**Version**: 2.1  
**Tech Stack**: Expo SDK 54, React v19, Firebase v12.4.0  
**Platform**: React Native with Expo Go  
**Date**: October 2025

---

## 📖 User Story & App Purpose

**VMStock** is a **multi-user, multi-organization offline-first tuck shop application** designed for schools, clubs, and organizations to manage their internal sales operations.

### Core User Journey:
1. **Organization Setup**: Admin creates an organization (e.g., "Vale Madrid Tuck Shop")
2. **Product Management**: Admin adds products with prices and stock levels
3. **Player Management**: Admin adds players (customers/students) who can purchase items
4. **Sales Transactions**: Staff members sell products to players, updating balances and stock
5. **Payment Tracking**: Players pay their bills, staff marks assignments as paid
6. **Multi-Device Sync**: Multiple staff members can use different devices simultaneously
7. **Offline-First**: All operations work without internet, sync when connectivity returns

### Key Business Requirements:
- **Multi-Organization**: Single app instance supports multiple organizations
- **Multi-User**: Multiple staff members with role-based permissions
- **Offline-First**: Core functionality works without internet connection
- **Real-Time Sync**: Changes sync across devices when online
- **Financial Accuracy**: No double-charging, no lost transactions
- **Stock Management**: Accurate inventory tracking across devices
- **Audit Trail**: Complete transaction history and conflict resolution

---

## 🏗️ Tech Stack & Dependencies

### Core Framework
```json
{
  "expo": "~54.0.0",
  "react": "18.3.1",
  "react-native": "0.76.0",
  "firebase": "12.4.0",
  "expo-secure-store": "~14.0.0",
  "@react-native-async-storage/async-storage": "~2.1.0",
  "uuid": "^10.0.0"
}
```

### Key Libraries
- **Firebase Web SDK v12.4.0**: Authentication, Firestore, Storage
- **Expo SecureStore**: Secure device-native auth token storage  
- **AsyncStorage**: Primary local cache and offline data persistence layer
- **UUID**: Deterministic ID generation for offline entities
- **React Navigation**: App navigation and state management
- **NetInfo**: Network connectivity detection for sync logic

### Development Tools
- **TypeScript**: Full type safety across codebase
- **ESLint/Prettier**: Code quality and formatting
- **Expo Development Build**: Testing on physical devices
- **Firebase Emulator Suite**: Local development environment

---

## 🔐 Authentication Architecture

### Firebase Auth + SecureStore Integration

**Problem Solved**: Firebase Auth default persistence doesn't work reliably on React Native, especially iOS TestFlight builds.

**Solution**: Custom SecureStore-backed persistence layer that integrates with Firebase Web SDK.

#### Implementation (`config/firebase.ts`):
```typescript
// Custom SecureStore persistence class for Firebase Auth
class SecureStorePersistence {
  static type = 'LOCAL';
  type = 'LOCAL';

  async _get(key: string): Promise<string | null> {
    try {
      const value = await SecureStore.getItemAsync(key);
      console.log(`🔐 SecureStore _get(${key}):`, value ? 'Found' : 'Not found');
      return value;
    } catch (error) {
      console.error('🔐 SecureStore get error:', error);
      return null;
    }
  }

  async _set(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(
        key, 
        value,
        Platform.OS === 'ios'
          ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
          : {}
      );
      console.log(`🔐 SecureStore _set(${key}): Success`);
    } catch (error) {
      console.error('🔐 SecureStore set error:', error);
    }
  }

  async _remove(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
      console.log(`🔐 SecureStore _remove(${key}): Success`);
    } catch (error) {
      console.error('🔐 SecureStore remove error:', error);
    }
  }

  _addListener(_key: string, _listener: () => void): void {}
  _removeListener(_key: string, _listener: () => void): void {}
}

// Firebase Auth initialization with SecureStore persistence
let authInstance: Auth | null = null;
function getAuthInstance(): Auth {
  if (authInstance) return authInstance;
  
  if (Platform.OS === 'web') {
    const { initializeAuth, indexedDBLocalPersistence } = require('firebase/auth');
    authInstance = initializeAuth(app, { persistence: indexedDBLocalPersistence });
    console.log('🔐 Web: Using indexedDB persistence');
  } else {
    // React Native: Use custom SecureStore persistence
    const { initializeAuth } = require('firebase/auth');
    const secureStorePersistence = new SecureStorePersistence();
    authInstance = initializeAuth(app, {
      persistence: secureStorePersistence as any,
    });
    console.log('🔐 React Native: Using SecureStore for Firebase Auth persistence');
  }
  
  return authInstance!;
}
```

#### Key Benefits:
- **Device-Native Security**: iOS Keychain, Android EncryptedSharedPreferences
- **Reliable Persistence**: Works across app restarts, TestFlight, EAS builds
- **No Custom Auth Layer**: Leverages Firebase's built-in mechanisms
- **Debug Visibility**: Comprehensive logging for troubleshooting

---

## 👤 User Authentication & Onboarding Flow

### Complete User Journey Architecture

VMStock implements a sophisticated user authentication and role-based onboarding system that handles multiple user types and organization structures. The flow is managed by `AuthWrapper.tsx`, `OrganizationContext.tsx`, and `AuthContext.tsx`.

### Core User Types & Roles

```typescript
interface StaffUser {
  uid: string;             // Firebase Auth UID
  email: string;           // User email
  role: 'owner' | 'admin' | 'staff';
  isOwner: boolean;        // Organization owner (full access + debug)
  isAdmin: boolean;        // Admin access (no debug panel)
  permissions: {
    canManageUsers: boolean;      // Create/edit/delete players
    canManageProducts: boolean;   // Create/edit/delete products
    canMakeSales: boolean;        // Create assignments
    canManageAssignments: boolean; // Edit/delete assignments
    canViewReports: boolean;      // Access analytics
    canManageStaff: boolean;      // Add/remove staff (admin only)
  };
  organizationId: string;
}

interface Player {
  id: string;
  name: string;
  assignedUserId?: string; // Links Firebase user to player record
  balance: number;
  // ... other player fields
}
```

---

## 🔄 Authentication Flow State Machine

### Flow 1: New User Sign Up → Organization Setup (Admin)

```typescript
// State progression managed by AuthWrapper.tsx
AuthState: NotAuthenticated
  ↓ User creates account via LoginScreen
  ↓ Firebase Auth creates user
AuthState: Authenticated, EmailNotVerified
  ↓ User verifies email
AuthState: Authenticated, EmailVerified
  ↓ OrganizationContext.checkExistingUserOrganization()
  ↓ No existing organization found
OrgState: SetupRequired
  ↓ User completes OrganizationSetupScreen
  ↓ Creates organization + staff record (role: 'admin')
OrgState: SetupComplete
  ↓ SyncingScreen hydrates data from server
SyncState: Complete
  ↓ HomePage loads with FULL ADMIN ACCESS + ORG SETTINGS (no debug panel)
```

**Implementation Details:**
```typescript
// OrganizationContext.tsx - New organization creation
const createOrganization = async (orgData: Partial<Organization>): Promise<void> => {
  const id = orgData.name?.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-');
  
  const organization: Organization = {
    id,
    name: orgData.name!,
    displayName: orgData.displayName || orgData.name!,
    type: orgData.type || 'tuck-shop',
    currency: 'GBP',
    shopPin: Math.random().toString(36).substr(2, 8).toUpperCase(),
    settings: {
      allowNegativeBalance: true,
      requireParentEmail: false,
      autoSyncInterval: 300000
    }
  };

  // Create staff record for organization admin (organization creator)
  const adminStaffRecord = {
    id: FirebaseAuth.currentUser!.uid,
    uid: FirebaseAuth.currentUser!.uid,
    email: FirebaseAuth.currentUser!.email!,
    displayName: FirebaseAuth.currentUser!.displayName || 'Admin',
    role: 'admin',
    isOwner: false,
    isAdmin: true,
    permissions: {
      canManageUsers: true,
      canManageProducts: true, 
      canMakeSales: true,
      canManageAssignments: true,
      canViewReports: true,
      canManageStaff: true
    },
    organizationId: id,
    isActive: true
  };

  // Apply operations through HybridSyncService
  await hybridSyncService.applyOp({
    id: generateUUID(),
    type: 'create',
    collection: 'organizations', 
    entityId: id,
    data: organization,
    metadata: { /* ... */ }
  });

  await hybridSyncService.applyOp({
    id: generateUUID(),
    type: 'create',
    collection: 'staff-users',
    entityId: adminStaffRecord.uid,
    data: adminStaffRecord,
    metadata: { /* ... */ }
  });
};
```

### Flow 2: New User Sign Up → Organization Join (Staff)

```typescript
AuthState: NotAuthenticated
  ↓ User creates account via LoginScreen  
AuthState: Authenticated, EmailNotVerified
  ↓ User verifies email
AuthState: Authenticated, EmailVerified
  ↓ OrganizationContext.checkExistingUserOrganization()
  ↓ No existing organization found
OrgState: SetupRequired
  ↓ User enters organization PIN on OrganizationSetupScreen
  ↓ PIN validated, user added as staff member (role: 'staff')
  ↓ AWAITING ADMIN APPROVAL - limited permissions
OrgState: SetupComplete
  ↓ SyncingScreen hydrates data
SyncState: Complete
  ↓ HomePage loads with LIMITED ACCESS (no admin features)
```

**Implementation Details:**
```typescript
// OrganizationSetupScreen.tsx - Join existing organization
const joinOrganization = async (pin: string): Promise<void> => {
  // Find organization by PIN
  const organizations = await firebaseService.getOrganizations();
  const targetOrg = organizations.find(org => org.shopPin === pin);
  
  if (!targetOrg) {
    throw new Error('Invalid PIN');
  }

  // Create staff record with minimal permissions
  const newStaffRecord = {
    id: FirebaseAuth.currentUser!.uid,
    uid: FirebaseAuth.currentUser!.uid,
    email: FirebaseAuth.currentUser!.email!,
    role: 'staff',
    isOwner: false,
    isAdmin: false,
    permissions: {
      canManageUsers: false,
      canManageProducts: false,
      canMakeSales: true,        // Can make sales
      canManageAssignments: false,
      canViewReports: false,
      canManageStaff: false
    },
    organizationId: targetOrg.id,
    isActive: false // Requires admin approval
  };

  await hybridSyncService.applyOp({
    id: generateUUID(),
    type: 'create',
    collection: 'staff-users',
    entityId: newStaffRecord.uid,
    data: newStaffRecord,
    metadata: { /* ... */ }
  });
};
```

### Flow 3: Existing User Sign In → Admin Access

```typescript
AuthState: NotAuthenticated
  ↓ User signs in via LoginScreen
  ↓ SecureStore restores auth tokens
AuthState: Authenticated
  ↓ OrganizationContext.checkExistingUserOrganization()
  ↓ Finds existing staff record (role: 'admin')
  ↓ Auto-loads organization from cache
OrgState: SetupComplete
  ↓ AuthContext.checkUserRole() sets isAdmin: true, isOwner: false
  ↓ SyncingScreen hydrates latest data
SyncState: Complete
  ↓ HomePage loads with FULL ADMIN ACCESS (no debug panel)
```

### Flow 4: Existing User Sign In → Owner Access (Developer Only)

```typescript
// OWNER ROLE: Set manually in Firebase database by developer
// NOT created through any sign-up flow - developer privilege only

AuthState: NotAuthenticated
  ↓ Developer signs in via LoginScreen
AuthState: Authenticated  
  ↓ checkExistingUserOrganization() finds owner record (manually set)
  ↓ Auto-setup for vale-madrid-tuck-shop organization
OrgState: SetupComplete
  ↓ checkUserRole() sets isAdmin: true, isOwner: true
SyncState: Complete
  ↓ HomePage loads with OWNER ACCESS (includes debug panel)
```

**Special Case - Vale Madrid Auto-Setup:**
```typescript
// OrganizationContext.tsx - Auto-setup for existing Vale Madrid users
const checkExistingUserOrganization = async (): Promise<void> => {
  const currentUser = FirebaseAuth.currentUser;
  if (!currentUser) return;

  // Check for existing staff record in vale-madrid-tuck-shop
  firebaseService.setOrganizationId('vale-madrid-tuck-shop');
  const staffUsers = await firebaseService.getStaffUsers();
  const userStaffRecord = staffUsers.find(staff => 
    staff.uid === currentUser.uid || staff.email === currentUser.email
  );

  if (userStaffRecord && userStaffRecord.organizationId === 'vale-madrid-tuck-shop') {
    // Auto-create local organization record
    const valeOrganization: Organization = {
      id: 'vale-madrid-tuck-shop',
      name: 'Vale Madrid Tuck Shop', 
      displayName: 'Vale Madrid Tuck Shop',
      type: 'tuck-shop',
      currency: 'GBP',
      settings: {
        allowNegativeBalance: true,
        requireParentEmail: false,
        autoSyncInterval: 300000
      }
    };

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(valeOrganization));
    setOrganization(valeOrganization);
    setIsSetupComplete(true);
    console.log('✅ Auto-setup for existing Vale Madrid user');
  }

  setHasCheckedExistingUser(true);
};
```

### Flow 5: Existing User Sign In → Assigned Player Access

```typescript
AuthState: NotAuthenticated
  ↓ User signs in
AuthState: Authenticated
  ↓ checkExistingUserOrganization() - no staff record found  
  ↓ checkUserRole() finds player with assignedUserId matching user.uid
  ↓ Sets assignedPlayer record, isAdmin: false
OrgState: SetupComplete (using cached organization)
SyncState: Complete
  ↓ HomePage loads with PLAYER ACCESS (Buy Products / View Bills only)
```

**Player Assignment Logic:**
```typescript
// AuthContext.tsx - Check for assigned player
const checkUserRole = useCallback(async () => {
  const currentUser = FirebaseAuth.currentUser;
  if (!currentUser) return;

  // Check for staff record first
  const staffUsers = await firebaseService.getStaffUsers();
  const staffUser = staffUsers.find(staff => staff.uid === currentUser.uid);
  
  if (staffUser) {
    setIsAdmin(staffUser.isAdmin || staffUser.role === 'admin' || staffUser.role === 'owner');
    setIsOwner(staffUser.role === 'owner');
  } else {
    // No staff record - check for assigned player
    const players = await firebaseService.getPlayers();
    const assignedPlayerRecord = players.find(player => 
      player.assignedUserId === currentUser.uid
    );
    
    setAssignedPlayer(assignedPlayerRecord || null);
    setIsAdmin(false);
    setIsOwner(false);
  }
}, [user]);
```

---

## 🏠 Home Page Experience by User Type

### Owner Experience (Developer Only - Full Access + Debug)
```typescript
// HomePage.tsx - Owner view (DEVELOPER ONLY - manually set in database)
if (isOwner) {
  // All admin features + debug tools
  menuItems = [
    { name: 'Products', icon: 'package-variant', screen: 'Products' },
    { name: 'Players', icon: 'account-group', screen: 'Users' },
    { name: 'Assignments', icon: 'clipboard-list', screen: 'Assignments' },
    { name: 'Stock Take', icon: 'clipboard-check', screen: 'Stock Take' },
    { name: 'Reports', icon: 'chart-bar', screen: 'Reports' },
    { name: 'Player Bills', icon: 'receipt', screen: 'PlayerBills' },
    { name: 'Player Charges', icon: 'credit-card', screen: 'PlayerCharges' },
    { name: 'Organization', icon: 'office-building', screen: 'OrganizationSettings' },
    
    // DEVELOPER-ONLY debug features
    { name: 'Sync Debug', icon: 'bug', screen: 'SyncDebug' },
    { name: 'Auth Test', icon: 'shield-key', screen: 'FirebaseAuthTest' }
  ];
}
```

### Admin Experience (Organization Creator - Full Access + Org Settings)
```typescript
if (isAdmin && !isOwner) {
  menuItems = [
    { name: 'Products', icon: 'package-variant', screen: 'Products' },
    { name: 'Players', icon: 'account-group', screen: 'Users' },
    { name: 'Assignments', icon: 'clipboard-list', screen: 'Assignments' },
    { name: 'Stock Take', icon: 'clipboard-check', screen: 'Stock Take' },
    { name: 'Reports', icon: 'chart-bar', screen: 'Reports' },
    { name: 'Player Bills', icon: 'receipt', screen: 'PlayerBills' },
    { name: 'Player Charges', icon: 'credit-card', screen: 'PlayerCharges' },
    { name: 'Organization', icon: 'office-building', screen: 'OrganizationSettings' }
    // NO debug panel access (developer only)
  ];
}
```

### Staff Experience (Limited Access)
```typescript
if (!isAdmin && !assignedPlayer) {
  // Staff member with no player assignment - awaiting approval
  menuItems = [
    { name: 'Products', icon: 'package-variant', screen: 'Products' }, // View only
    { name: 'Make Sale', icon: 'cash-register', action: 'quickSale' }
    // Limited functionality until admin approves
  ];
}
```

### Assigned Player Experience (Consumer View)
```typescript
if (assignedPlayer && !isAdmin) {
  // Player assigned to user account
  const playerBalance = assignedPlayer.balance / 100; // Convert from cents
  
  // Show player-specific dashboard
  return (
    <PlayerDashboard 
      player={assignedPlayer}
      balance={playerBalance}
      canPurchase={true}
      canViewBills={true}
    />
  );
  
  menuItems = [
    { name: 'Buy Products', icon: 'shopping', action: 'purchase' },
    { name: 'My Bills', icon: 'receipt', screen: 'PlayerBills', 
      params: { playerId: assignedPlayer.id } },
    { name: 'Payment History', icon: 'history', screen: 'PaymentHistory' }
  ];
}
```

---

## 🔐 Role-Based Navigation & Security

### AppNavigator Screen Registration
```typescript
// All screens are registered but access is controlled at component level
<Stack.Navigator>
  <Stack.Screen name="Home" component={HomePage} />
  <Stack.Screen name="Products" component={ProductsPage} />      // Role check inside
  <Stack.Screen name="Users" component={PlayersPage} />          // Admin only
  <Stack.Screen name="Assignments" component={AssignmentsPage} /> // Admin only
  <Stack.Screen name="PlayerBills" component={PlayerBills} />     // Role-based filtering
  <Stack.Screen name="PlayerCharges" component={PlayerCharges} /> // Admin only
  <Stack.Screen name="SyncDebug" component={SyncDebugPanel} />    // Owner only
  <Stack.Screen name="OrganizationSettings" component={OrganizationSettings} /> // Owner only
</Stack.Navigator>
```

### Component-Level Access Control
```typescript
// ProductsPage.tsx - Role-based feature access
export default function ProductsPage() {
  const { isAdmin, assignedPlayer } = useAuth();

  if (!isAdmin && !assignedPlayer) {
    // Staff member - read-only view
    return <ProductsList readOnly={true} />;
  }
  
  if (assignedPlayer && !isAdmin) {
    // Assigned player - purchase interface
    return <ProductsPurchaseView player={assignedPlayer} />;
  }
  
  if (isAdmin) {
    // Admin/Owner - full management interface
    return <ProductsManagementView />;
  }
}
```

### Authentication State Persistence
```typescript
// AuthWrapper.tsx - State management priorities
const AuthWrapper = () => {
  // 1. Wait for Firebase Auth initialization (SecureStore restoration)
  if (!authInitialized || authLoading) {
    return <LoadingScreen message="Initializing..." />;
  }

  // 2. Show login if not authenticated
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // 3. Email verification gate
  if (!isEmailVerified) {
    return <EmailVerificationScreen />;
  }

  // 4. Organization detection/setup
  if (!hasCheckedExistingUser) {
    return <LoadingScreen message="Checking organization..." />;
  }

  if (!isSetupComplete) {
    return <OrganizationSetupScreen />; // Create or join org
  }

  // 5. Data hydration
  if (!isSyncComplete) {
    return <SyncingScreen onSyncComplete={() => setIsSyncComplete(true)} />;
  }

  // 6. Main application
  return <AppNavigator />;
};
```

This authentication architecture ensures secure, role-based access while maintaining the offline-first design principles throughout the user journey.

---

## 🏢 Multi-Organization Architecture

### Organization Context & Cache Isolation

Each organization gets isolated data cache to prevent cross-contamination:

```typescript
// contexts/OrganizationContext.tsx
const STORAGE_KEY = 'vmstock_organization';

export const OrganizationProvider: React.FC<OrganizationProviderProps> = ({ children }) => {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSetupComplete, setIsSetupComplete] = useState(false);

  // Organization detection for existing users
  const checkExistingUserOrganization = async (): Promise<void> => {
    const currentUser = FirebaseAuth.currentUser;
    if (!currentUser) return;

    // Check if user is admin of vale-madrid-tuck-shop
    firebaseService.setOrganizationId('vale-madrid-tuck-shop');
    const staffUsers = await firebaseService.getStaffUsers();
    const userStaffRecord = staffUsers.find(staff => 
      staff.uid === currentUser.uid || staff.email === currentUser.email
    );

    if (userStaffRecord && userStaffRecord.organizationId === 'vale-madrid-tuck-shop') {
      // Load organization and cache
      const orgData = await loadOrganizationFromServer('vale-madrid-tuck-shop');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(orgData));
      setOrganization(orgData);
      setIsSetupComplete(true);
    }
  };

  // Clear organization cache on logout/switch
  const clearOrganization = async (): Promise<void> => {
    if (organization?.id) {
      // Clear HybridSyncService cache to prevent cross-org contamination
      await hybridSyncService.clearSyncQueue();
      await hybridSyncService.clearAllStuckData();
      await hybridSyncService.clearPendingBundles();
    }
    
    await AsyncStorage.removeItem(STORAGE_KEY);
    setOrganization(null);
    setIsSetupComplete(false);
  };
};
```

---

## 🗄️ Complete Firestore Schema

### Organization Structure
```
/organizations/{orgId}
├── /products/{productId}
│   └── /stockDeltas/{opId}           // Stock change events (signed deltas)
├── /players/{playerId}
│   └── /balanceDeltas/{opId}         // Balance change events (signed deltas)  
├── /assignments/{assignmentId}
├── /staff-users/{staffId}
├── /appliedOps/{opId}                // Idempotency tracking for operations
├── /sync-metadata/{deviceId}         // Device sync state and vector clocks
└── /audit-logs/{logId}               // Complete operation audit trail
```

### Entity Schemas

#### Product Entity
```typescript
interface Product {
  id: string;              // UUID - Primary Key
  name: string;            // Product name
  category: string;        // Product category
  price: number;           // Unit price in cents
  stock: number;           // Current stock level (materialized from stockDeltas)
  reserved: number;        // Reserved stock (pending transactions)
  isActive: boolean;       // Soft delete flag
  organizationId: string;  // Organization reference
  
  // Audit fields
  createdAt: Timestamp;    // Firestore server timestamp
  updatedAt: Timestamp;    // Firestore server timestamp
  createdBy: string;       // User ID who created
  updatedBy: string;       // User ID who last updated
  
  // Offline-first fields (local only)
  version?: VectorClock;   // For conflict resolution
  localCreatedAt?: string; // ISO string for local operations
  localUpdatedAt?: string; // ISO string for local operations
}

// Stock Delta Event (CRDT-friendly stock changes)
interface StockDelta {
  opId: string;            // Unique operation ID for idempotency
  productId: string;       // Product reference  
  delta: number;           // Signed change (+5 restock, -3 sale)
  source: 'sale' | 'restock' | 'adjustment' | 'stocktake';
  createdAt: Timestamp;    // When delta was applied
  createdBy: string;       // User who made the change
  bundleId?: string;       // Transaction bundle reference
}

// Firestore Collections:
// - Main: organizations/{orgId}/products
// - Deltas: organizations/{orgId}/products/{productId}/stockDeltas
// Local AsyncStorage Key: products (shared across users per organization)
```

#### Player Entity
```typescript
interface Player {
  id: string;              // UUID - Primary Key
  firstName: string;       // Player first name
  lastName: string;        // Player last name
  name: string;            // Computed: firstName + " " + lastName
  balance: number;         // Running debt/credit balance (materialized from balanceDeltas)
  totalPurchases: number;  // Count of transactions
  totalSpent: number;      // Lifetime spending (cents)
  lastPurchaseDate: Timestamp | null; // Last transaction date
  isActive: boolean;       // Soft delete flag
  organizationId: string;  // Organization reference
  
  // Contact info (optional)
  email?: string;          // Player email
  phone?: string;          // Player phone
  parentEmail?: string;    // Parent/guardian email
  
  // Audit fields
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
  
  // Offline-first fields (local only)
  version?: VectorClock;
  localCreatedAt?: string;
  localUpdatedAt?: string;
}

// Balance Delta Event (CRDT-friendly balance changes)
interface BalanceDelta {
  opId: string;            // Unique operation ID for idempotency
  playerId: string;        // Player reference
  delta: number;           // Signed change (+500 payment, -300 purchase)
  source: 'purchase' | 'payment' | 'adjustment' | 'refund';
  assignmentId?: string;   // Related assignment (for purchases)
  createdAt: Timestamp;    // When delta was applied
  createdBy: string;       // User who made the change
  bundleId?: string;       // Transaction bundle reference
  notes?: string;          // Optional description
}

// Firestore Collections:
// - Main: organizations/{orgId}/players  
// - Deltas: organizations/{orgId}/players/{playerId}/balanceDeltas
// Local AsyncStorage Key: players (shared across users per organization)
```

#### Assignment Entity (Sales Transaction)
```typescript
interface Assignment {
  id: string;              // UUID - Primary Key
  playerId: string;        // Foreign Key → Player.id
  productId: string;       // Foreign Key → Product.id
  
  // Denormalized fields (for performance)
  userName: string;        // Player.name at time of transaction
  productName: string;     // Product.name at time of transaction
  
  // Transaction details
  quantity: number;        // Quantity sold
  unitPrice: number;       // Price per unit (cents)
  total: number;           // quantity * unitPrice
  
  // Payment tracking
  paid: boolean;           // Payment status
  paidAt?: Timestamp;      // Payment timestamp
  paidBy?: string;         // User who marked as paid
  
  // Transaction status
  cancelled: boolean;      // Cancellation flag
  cancelledAt?: Timestamp; // Cancellation timestamp
  cancelledBy?: string;    // User who cancelled
  cancelReason?: string;   // Cancellation reason
  
  // Additional info
  notes?: string;          // Transaction notes
  date: string;            // Transaction date (ISO string)
  organizationId: string;  // Organization reference
  
  // Audit fields
  createdAt: Timestamp;
  updatedAt: Timestamp;  
  createdBy: string;
  updatedBy: string;
  
  // Offline-first fields (local only)
  version?: VectorClock;
  localCreatedAt?: string;
  localUpdatedAt?: string;
}

// Firestore Collection: organizations/{orgId}/assignments  
// Local Storage Key: assignments_{orgId}_{userId}
```

#### Staff User Entity
```typescript
interface StaffUser {
  id: string;              // UUID - Primary Key (firebase ID)
  uid: string;             // Firebase Auth UID
  email: string;           // User email
  displayName: string;     // User display name
  organizationId: string;  // Organization reference
  
  // Role-based permissions
  role: string;
  isOwner: boolean;
  isAdmin: boolean;        // Full admin access
  permissions: {
    canManageUsers: boolean;      // Create/edit/delete players
    canManageProducts: boolean;   // Create/edit/delete products  
    canMakeSales: boolean;        // Create assignments
    canManageAssignments: boolean; // Edit/delete assignments
    canViewReports: boolean;      // Access analytics
    canManageStaff: boolean;      // Add/remove staff (admin only)
  };
  
  // Status
  isActive: boolean;       // Account status
  lastLoginAt?: Timestamp; // Last login time
  
  // Audit fields
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;       // Admin who added user
  
  // Offline-first fields (local only)
  version?: VectorClock;
}

// Firestore Collection: organizations/{orgId}/staff-users
// Local Storage Key: staff_users_{orgId}_{userId}
```

#### Applied Operations (Idempotency Tracking)
```typescript
interface AppliedOp {
  opId: string;            // Primary Key - Unique operation identifier
  bundleId?: string;       // Transaction bundle reference (if part of multi-op)
  operationType: string;   // Type of operation (create, update, delete, etc.)
  collection: string;      // Target collection
  entityId: string;        // Target entity ID
  appliedAt: Timestamp;    // When operation was successfully applied
  appliedBy: string;       // User who applied the operation
  deviceId: string;        // Device that originated the operation
  vectorClock: VectorClock; // Causal ordering information
}

// Firestore Collection: organizations/{orgId}/appliedOps
// Used to prevent duplicate application of operations during sync
```

#### Vector Clock (Conflict Resolution)
```typescript
interface VectorClock {
  deviceId: string;        // Unique device identifier
  userId: string;          // User making the change
  organizationId: string;  // Organization context
  sequence: number;        // Monotonic sequence number
  timestamp: number;       // Unix timestamp
  vectorClock: Record<string, number>; // deviceId -> sequence
}
```

---

## 🚀 Offline-First Architecture

### Core Principles

1. **Local Cache as Source of Truth**: All reads come from local cache
2. **Optimistic Updates**: All writes update local cache immediately  
3. **Background Sync**: Server sync happens asynchronously
4. **Conflict Resolution**: Automatic handling of concurrent updates
5. **Transactional Integrity**: Multi-entity operations are atomic

### HybridSyncService - The Core Engine

```typescript
// services/HybridSyncService.ts
class HybridSyncService {
  // Single write entry point - ALL writes go through this
  async applyOp(operation: Operation): Promise<void> {
    // 1. Update local AsyncStorage cache immediately (optimistic)
    await this.updateLocalCache(operation);
    
    // 2. Queue for server sync (background)
    await this.queueForSync(operation);
    
    // 3. Attempt immediate sync if online
    if (await this.isOnline()) {
      this.syncToServer(operation);
    }
  }

  // AsyncStorage-based data access with provisional overlay
  async getProducts(): Promise<Product[]> {
    const baseData = await this.getLocalData('products'); // AsyncStorage
    const provisionalDeltas = await this.getProvisionalDeltas('products');
    return this.applyProvisionalOverlay(baseData, provisionalDeltas);
  }

  // Core AsyncStorage operations
  private async getLocalData(collection: string): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem(collection);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error(`❌ Error reading local ${collection}:`, error);
      return [];
    }
  }

  private async saveLocalData(collection: string, data: any[]): Promise<void> {
    try {
      await AsyncStorage.setItem(collection, JSON.stringify(data));
      console.log(`💾 Saved ${data.length} items to local ${collection}`);
    } catch (error) {
      console.error(`❌ Error saving local ${collection}:`, error);
      throw error;
    }
  }
}
```

### Provisional Overlay System

**Problem**: When server hydration occurs, we don't want to overwrite local changes that haven't synced yet.

**Solution**: Maintain separate layers of data:
- **Base Layer**: Last confirmed state from server
- **Provisional Layer**: Local changes not yet synced
- **Read Layer**: Base + Provisional combined

```typescript
// Example: Reading products with provisional overlay
const products = await hybridSyncService.getProducts();
// Returns: Server data + Local changes not yet synced

// When server hydration occurs:
// 1. Update base layer with server data
// 2. Keep provisional layer intact
// 3. Merge both for reads
// 4. Remove provisional items that successfully synced
```

---

## 🔄 BundleOp System - Transactional Operations

### Problem: Atomic Multi-Entity Operations

When selling a product to a player, three entities must be updated atomically:
1. Create Assignment record
2. Decrement Product stock  
3. Update Player balance

### Solution: BundleOp Transactions

```typescript
interface BundleOp {
  bundleId: string;        // Unique transaction ID
  type: 'assignmentSale' | 'stockTake' | 'payment';
  entityRefs: {            // All entities involved
    assignmentId?: string;
    productId?: string; 
    playerId?: string;
  };
  steps: Array<{           // Individual operations
    opId: string;          // Deterministic step ID
    kind: 'createAssignment' | 'stockDelta' | 'balanceDelta';
    payload: any;          // Operation data
  }>;
  vectorClock: VectorClock;
  timestamp: number;
  source: 'local' | 'server' | 'sync';
}

// Usage: Create assignment bundle transaction
async createAssignmentBundle(input: AssignmentInput): Promise<string> {
  const bundleId = generateUUID();
  
  const bundle: BundleOp = {
    bundleId,
    type: 'assignmentSale',
    entityRefs: {
      assignmentId: bundleId,
      productId: input.productId,
      playerId: input.playerId
    },
    steps: [
      {
        opId: hash(bundleId, 'createAssignment'),
        kind: 'createAssignment',
        payload: {
          id: bundleId,
          playerId: input.playerId,
          productId: input.productId,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          total: input.quantity * input.unitPrice,
          // ... other assignment fields
        }
      },
      {
        opId: hash(bundleId, 'decrementStock'),
        kind: 'stockDelta', 
        payload: {
          productId: input.productId,
          delta: -input.quantity
        }
      },
      {
        opId: hash(bundleId, 'updateBalance'),
        kind: 'balanceDelta',
        payload: {
          playerId: input.playerId,
          delta: input.quantity * input.unitPrice
        }
      }
    ],
    vectorClock: this.createVectorClock(),
    timestamp: Date.now(),
    source: 'local'
  };

  // Apply locally as atomic transaction
  await this.applyBundleLocally(bundle);
  
  // Queue for server sync
  await this.enqueueBundleForSync(bundle);
  
  return bundleId;
}
```

### Benefits of BundleOp:
- **Atomic**: All steps succeed or all fail
- **Idempotent**: Safe to retry (each step has unique opId)
- **Auditable**: Complete transaction history
- **Conflict-Safe**: Vector clocks track causality

---

## 🔀 Conflict Resolution Strategy

### Conflict Resolution Hierarchy

1. **Server Operations Always Win**
   ```typescript
   if (operation.source === 'server') {
     // Server data takes precedence
     return serverData;
   }
   ```

2. **Critical Fields Protection**
   ```typescript
   const criticalFields = ['paid', 'balance', 'stock'];
   if (conflictInvolvesCriticalField) {
     // Use timestamp-based resolution
     return newerTimestamp.data;
   }
   ```

3. **Vector Clock Comparison**
   ```typescript
   if (vectorClock1.dominates(vectorClock2)) {
     return data1; // Causal dominance
   } else if (vectorClock2.dominates(vectorClock1)) {
     return data2;
   } else {
     // Concurrent updates - use timestamp
     return newerTimestamp.data;
   }
   ```

4. **Additive Operations**
   ```typescript
   // For counters/balances, apply both changes
   if (operation.type === 'balanceDelta') {
     return baseBalance + delta1 + delta2;
   }
   ```

### Example Conflict Scenarios:

**Scenario 1**: User marks assignment as paid offline, server marks as unpaid
```typescript
Local:  { paid: true, paidAt: 1696608000000 }
Server: { paid: false, updatedAt: 1696607000000 }
Result: { paid: true, paidAt: 1696608000000 } // Local wins (newer + critical field)
```

**Scenario 2**: Concurrent stock updates from two devices
```typescript
Device A: stock: 50 → 45 (sold 5)
Device B: stock: 50 → 47 (sold 3)
Resolution: Apply both deltas → stock: 42 (50 - 5 - 3)
```

---

## 📱 Multi-Device & Multi-User Support

### Cache Isolation Strategy

Each organization gets isolated AsyncStorage cache namespaces:
```typescript
// Local AsyncStorage keys include organization context
const CACHE_KEY = `${collection}`; // Shared across users within organization

// Core collections (shared per organization):
// 'products' - All products for current organization
// 'players' - All players for current organization  
// 'assignments' - All assignments for current organization
// 'staff-users' - All staff for current organization

// User-specific keys:
// 'sync_queue' - User's pending operations
// 'cache_initialized_products_${userId}' - Cache initialization markers
// 'last_sync_players' - Last sync timestamps
// '@organization_data' - Current organization context (OrganizationContext)

// Organization-specific provisional overlays:
// 'provisional_assignments' - Bundle system provisional data
// 'provisional_stock_deltas' - Stock change overlays
// 'provisional_balance_deltas' - Balance change overlays
// 'provisional_organization_updates' - Organization settings overlays
// 'pending_bundles' - Queued transaction bundles
```

### Device Registration & Sync
```typescript
interface SyncMetadata {
  deviceId: string;        // Unique device identifier
  userId: string;          // Current user
  organizationId: string;  // Current organization
  lastSyncAt: Timestamp;   // Last successful sync
  syncStatus: 'active' | 'offline' | 'error';
  vectorClock: VectorClock; // Device's current vector clock
}

// Firestore Collection: organizations/{orgId}/sync-metadata/{deviceId}
```

### Logout Data Handling

```typescript
// Safe logout process with organization settings preservation
public async safelyLogoutUser(): Promise<void> {
  console.log('🔐 Starting safe user logout process');
  
  try {
    // Step 1: Force sync all pending operations (including org settings)
    if (this.syncQueue.length > 0) {
      console.log(`📤 Syncing ${this.syncQueue.length} pending operations before logout`);
      await this.forceSyncNow();
    }
    
    // Step 2: Verify all organization settings are synced
    if (this.isOnline) {
      await this.verifyAllDataSynced();
    } else {
      throw new Error('Cannot logout safely while offline - pending changes may be lost');
    }
    
    // Step 3: Clear cache after successful sync
    await this.clearCacheAfterSync();
    console.log('✅ Safe logout completed - all data preserved');
  } catch (error) {
    throw new Error(`Logout blocked to prevent data loss: ${error.message}`);
  }
}

// Clear cache after sync verification
private async clearCacheAfterSync(): Promise<void> {
  const collections = ['players', 'assignments', 'products', 'staff-users', 'organizations'];
  
  // Clear all collection data
  for (const collection of collections) {
    await AsyncStorage.removeItem(collection);
    await AsyncStorage.removeItem(`cache_initialized_${collection}_${currentUserKey}`);
    await AsyncStorage.removeItem(`last_sync_${collection}`);
  }
  
  // Clear organization context (matches OrganizationContext key)
  await AsyncStorage.removeItem('@organization_data');
  
  // Clear provisional overlays
  await AsyncStorage.removeItem('provisional_organization_updates');
  await AsyncStorage.removeItem('pending_bundles');
}
```

---

## 🔄 UPSERT Pattern for Server Sync

### Problem: Sync Failures Due to Document Conflicts

When syncing offline-created entities, server sync fails if documents already exist.

### Solution: Robust UPSERT Implementation

```typescript
// FirebaseService.ts - UPSERT methods
async upsertProduct(product: Product): Promise<void> {
  const productsRef = collection(FirebaseFirestore, this.getOrgCollection('products'));
  const docRef = doc(productsRef, product.id); // Use logical ID as document ID
  
  // Check if document exists
  const docSnap = await getDoc(docRef);
  
  const cleanProduct = this.sanitizeForFirestore(product);
  
  if (docSnap.exists()) {
    // Document exists - update
    await updateDoc(docRef, {
      ...cleanProduct,
      updatedAt: serverTimestamp(),
      updatedBy: this.currentUserId
    });
    console.log('✅ Product updated in Firebase:', product.id);
  } else {
    // Document doesn't exist - create
    await setDoc(docRef, {
      ...cleanProduct,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: this.currentUserId,
      updatedBy: this.currentUserId
    });
    console.log('✅ Product created in Firebase:', product.id);
  }
}

// Sanitize data for Firestore (remove local-only fields)
private sanitizeForFirestore(data: any): any {
  const { 
    version, 
    vectorClock, 
    localCreatedAt, 
    localUpdatedAt,
    ...cleanData 
  } = data;
  
  return cleanData;
}
```

### Assignment Transaction UPSERT
```typescript
// Sync compound assignment transaction with proper dependency order
private async syncAssignmentTransactionToServer(operation: Operation): Promise<void> {
  const firebaseService = new FirebaseService();
  
  // Get updated entities from local cache
  const product = await this.getLocalEntity('products', operation.data.productId);
  const player = await this.getLocalEntity('players', operation.data.playerId);
  const assignment = await this.getLocalEntity('assignments', operation.entityId);
  
  if (!product || !player || !assignment) {
    throw new Error(`Missing entities for assignment transaction: ${operation.entityId}`);
  }

  // STEP 1: Ensure product exists (UPSERT)
  await firebaseService.upsertProduct(product);
  
  // STEP 2: Ensure player exists (UPSERT) 
  await firebaseService.upsertPlayer(player);
  
  // STEP 3: Create assignment (UPSERT)
  await firebaseService.upsertAssignment(assignment);
  
  console.log('✅ Assignment transaction synced successfully:', operation.entityId);
}
```

---

## 🧩 Code Comments Strategy for LLM Context

### Component-Level Comments
```typescript
/**
 * COMPONENT: AssignmentsPage
 * PURPOSE: Display and manage sales transactions (assignments)
 * OFFLINE-FIRST: Reads from local cache, writes through HybridSyncService
 * 
 * KEY FEATURES:
 * - Real-time list of assignments with payment status
 * - Optimistic updates (mark as paid instantly)
 * - Conflict resolution for concurrent payment updates
 * - Role-based permissions (canManageAssignments)
 * 
 * DATA FLOW:
 * 1. Component reads assignments via useAssignments() hook
 * 2. Hook calls hybridSyncService.getAssignments() (local cache + provisional overlay)
 * 3. User actions (mark paid) call hybridSyncService.applyOp()
 * 4. Local cache updated immediately, sync queued for background
 * 
 * SYNC BEHAVIOR:
 * - On mount: Triggers background hydration from server
 * - On user action: Optimistic local update + background sync
 * - On conflict: Server wins for 'paid' status, timestamp-based resolution
 */
export const AssignmentsPage: React.FC = () => {
  // Component implementation...
};
```

### Service-Level Comments
```typescript
/**
 * SERVICE: HybridSyncService
 * PURPOSE: Core offline-first data layer with conflict resolution
 * 
 * ARCHITECTURE:
 * - Single write entry point via applyOp()
 * - Provisional overlay system for reads
 * - Background sync with outbox pattern
 * - Vector clock-based conflict resolution
 * 
 * KEY METHODS:
 * - applyOp(): Universal write operation
 * - getProducts/Players/Assignments(): Reads with provisional overlay
 * - createAssignmentBundle(): Atomic multi-entity transaction  
 * - syncToServer(): Background server synchronization
 * 
 * CACHE STRUCTURE:
 * - Base layer: Last confirmed server state
 * - Provisional layer: Unsynced local changes
 * - Read layer: Base + Provisional merged
 * 
 * CONFLICT RESOLUTION:
 * 1. Server operations always win
 * 2. Critical fields use timestamp resolution
 * 3. Vector clocks detect concurrent updates
 * 4. Additive operations preserve both changes
 */
class HybridSyncService {
  // Service implementation...
}
```

### Hook-Level Comments
```typescript
/**
 * HOOK: useProducts
 * PURPOSE: Reactive access to products with offline-first behavior
 * 
 * BEHAVIOR:
 * - Returns cached data immediately (no loading states)
 * - Triggers background hydration on mount
 * - Updates when local cache changes
 * - Handles provisional overlays automatically
 * 
 * SYNC INTEGRATION:
 * - Initial load: Local cache → Background server hydration
 * - Updates: Optimistic local updates → Background sync
 * - Conflicts: Automatic resolution with user notification
 * 
 * USAGE:
 * const { products, isHydrating, error } = useProducts();
 * // products: Always available (cached or empty array)
 * // isHydrating: Background server sync status
 * // error: Sync errors (non-blocking)
 */
export const useProducts = () => {
  // Hook implementation...
};
```

---

## 🚦 Implementation Checklist

### Authentication Layer
- [x] SecureStore-based Firebase Auth persistence
- [x] Custom persistence class for React Native
- [x] Multi-platform support (iOS/Android/Web)
- [x] Debug utilities for auth verification
- [ ] Biometric authentication support

### Organization Management  
- [x] Multi-organization support
- [x] Organization detection for existing users
- [x] Cache isolation per organization
- [x] Proper cache cleanup on logout/switch
- [ ] Organization invitation system

### Offline-First Core
- [x] HybridSyncService with applyOp() pattern
- [x] Provisional overlay system
- [x] Vector clock conflict resolution
- [x] BundleOp transactional operations
- [ ] Compression for large datasets
- [ ] Background sync optimization

### Data Synchronization
- [x] UPSERT pattern for server sync
- [x] Outbox pattern for reliability
- [x] Idempotent operations
- [x] Conflict resolution hierarchy
- [ ] Delta compression for bandwidth efficiency
- [ ] Sync status indicators in UI

### Role-Based Access Control
- [x] Staff user permissions system
- [x] UI-level permission checks
- [x] Server-side permission validation
- [ ] Granular permission management UI
- [ ] Audit logging for permission changes

### Performance & Monitoring
- [ ] Performance metrics collection
- [ ] Sync latency monitoring
- [ ] Error tracking and reporting
- [ ] Cache size management
- [ ] Memory usage optimization

---

## 🎯 Development Guidelines for LLMs

### When Reading VMStock Code:

1. **Look for Component Comments**: Each component has detailed purpose and data flow documentation
2. **Understand applyOp() Pattern**: All writes go through this single entry point
3. **Cache Key Patterns**: All storage keys include organization and user context
4. **Provisional Overlays**: Reads combine base data + local changes
5. **BundleOp Transactions**: Multi-entity operations are atomic
6. **Conflict Resolution**: Server wins → Critical fields → Vector clocks → Timestamps

### When Writing VMStock Code:

1. **Always Use applyOp()**: Never write directly to AsyncStorage
2. **Add Component Comments**: Include purpose, data flow, and sync behavior
3. **Handle Offline-First**: Assume network can fail at any time
4. **Respect Permissions**: Check user roles before showing/allowing actions
5. **Use Typed Interfaces**: Leverage TypeScript for data consistency
6. **Include Debug Logs**: Add meaningful console logs for troubleshooting
7. **AsyncStorage Keys**: Use simple collection names ('products', 'players', etc.)
8. **Delta Events**: Use stockDeltas/balanceDeltas for CRDT-style updates

### Common Patterns:

```typescript
// ✅ Correct: Write through applyOp (updates AsyncStorage + queues sync)
await hybridSyncService.applyOp({
  type: 'update',
  collection: 'products',
  entityId: productId,
  data: updatedProduct
});

// ❌ Incorrect: Direct AsyncStorage write (bypasses sync system)
await AsyncStorage.setItem('products', JSON.stringify(products));

// ✅ Correct: Read with provisional overlay (AsyncStorage + pending changes)
const products = await hybridSyncService.getProducts();

// ❌ Incorrect: Direct AsyncStorage read (misses pending changes)
const rawProducts = await AsyncStorage.getItem('products');

// ✅ Correct: Delta-based stock update (CRDT-friendly)
await hybridSyncService.applyOp({
  type: 'stockDelta',
  collection: 'products',
  entityId: productId,
  data: { delta: -5, reason: 'sale', bundleId: assignmentId }
});

// ❌ Incorrect: Direct stock assignment (causes conflicts)
product.stock = newStockValue;
```

---

## 📊 Monitoring & Debugging

### Debug Utilities
- `verifyFirebaseAuthKeys()`: Check auth persistence status
- `testOfflineSync()`: Verify offline-first behavior
- `checkCacheIntegrity()`: Validate cache consistency
- `inspectVectorClocks()`: Debug conflict resolution

### Performance Metrics
- Sync latency (local → server)
- Cache hit rates
- Conflict resolution frequency
- Network request batching efficiency

### Error Handling
- Graceful degradation for network failures
- User-friendly error messages
- Automatic retry with exponential backoff
- Comprehensive error logging

---

## 🔧 Stock Integrity & Debug System

### Idempotency-First Architecture

**VMStock** implements enterprise-grade operation idempotency to ensure data integrity in multi-user offline scenarios. All stock and balance operations must be idempotent and conflict-safe.

### Core Design Principles for Stock Operations

1. **Always Check for Duplicate Operations**: Every provisional operation must verify opId uniqueness
2. **Use Delta-Based Updates**: Never set absolute values; always use signed deltas (+/-) 
3. **Implement Bundle-Level Deduplication**: Prevent double-commits during sync
4. **Provide Debug Tooling**: Include reconciliation and analysis tools for operations team

### Required Idempotency Implementation

#### Provisional Operation Safety

```typescript
// HybridSyncService.ts - All provisional operations must check for duplicates
private async addProvisionalStockDelta(productId: string, delta: number, opId: string): Promise<void> {
  const provisionalKey = 'provisional_stock_deltas';
  const dataStr = await AsyncStorage.getItem(provisionalKey);
  const data = dataStr ? JSON.parse(dataStr) : {};
  if (!data[productId]) data[productId] = [];
  
  // 🔒 REQUIRED: Check for duplicate opId before adding
  const existingOp = data[productId].find((op: any) => op.opId === opId);
  if (existingOp) {
    console.warn(`🚨 Preventing duplicate stock delta for product ${productId}, opId: ${opId}`);
    return; // Skip adding duplicate operation
  }
  
  data[productId].push({ delta, opId, timestamp: Date.now() });
  await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
}
```

#### Bundle Commit Safety

```typescript
// HybridSyncService.ts - Prevent double-commits to base cache
private async commitProvisionalToBaseCache(bundle: any, committedOpIds: string[]): Promise<void> {
  // 🔒 REQUIRED: Track already committed operations
  const alreadyCommitted = new Set<string>();
  
  for (const step of bundle.steps) {
    if (!committedOpIds.includes(step.opId)) continue;
    
    // 🚨 CRITICAL: Prevent duplicate commits to base cache
    if (alreadyCommitted.has(step.opId)) {
      console.warn(`🚨 Skipping duplicate commit for opId: ${step.opId}`);
      continue;
    }
    alreadyCommitted.add(step.opId);
    
    // Apply operation to base cache...
  }
}
```

### Stock Reconciliation System

#### StockReconciliationTool (`utils/StockReconciliationTool.ts`)

Essential utility for detecting and fixing stock integrity issues:

```typescript
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

export class StockReconciliationTool {
  // Analyze all products for stock inconsistencies
  async analyzeStockIssues(): Promise<ReconciliationReport>
  
  // Apply recommended fixes automatically
  async applyFixes(fixes: ReconciliationReport['recommendedFixes']): Promise<void>
  
  // Clean up duplicate operations from provisional storage
  async cleanupDuplicateOperations(): Promise<number>
}
```

#### StockDebugPanel (`components/StockDebugPanel.tsx`)

Owner-only debugging interface integrated into HomePage menu:

```typescript
// Features for operations team:
// - 🔍 Analyze Stock Issues: Full system scan
// - 🔧 Apply Fixes: One-click problem resolution  
// - 🧹 Cleanup Duplicates: Remove duplicate operations
// - 📊 Load Debug Data: Inspect cache contents
// - 🗑️ Clear All Caches: Emergency reset

// HomePage integration (Owner access only):
{isOwner && (
  <TouchableOpacity 
    onPress={() => setShowStockDebugPanel(true)}
    style={styles.menuItem}
  >
    <Icon name="package-variant" size={20} color="#ff3b30" />
    <Text style={styles.menuText}>🔧 Stock Debug</Text>
  </TouchableOpacity>
)}
```

### Development Best Practices

#### When Adding Stock Operations

1. **Always use unique opIds**: `hash(bundleId, operationType)` or `generateUUID()`
2. **Implement duplicate checks**: Check existing opIds before adding operations
3. **Use delta-based updates**: Never set absolute stock values
4. **Test multi-user scenarios**: Verify operations work with concurrent users
5. **Include debug logging**: Log when duplicates are detected and prevented

#### Source of Truth Hierarchy

1. **Server Operations**: Always take precedence during sync
2. **Local Operations**: Must be idempotent and conflict-safe
3. **Provisional Overlay**: Temporary layer for unsynced changes
4. **Base Cache**: Confirmed server state after successful sync

#### Required Testing Patterns

```typescript
// Test duplicate operation prevention
test('should prevent duplicate stock deltas', async () => {
  await hybridSync.addProvisionalStockDelta('product1', -5, 'op123');
  await hybridSync.addProvisionalStockDelta('product1', -5, 'op123'); // Should be skipped
  
  const deltas = await hybridSync.getProvisionalStockDeltas('product1');
  expect(deltas).toHaveLength(1); // Only one operation should exist
});

// Test bundle commit idempotency  
test('should not double-commit bundle operations', async () => {
  const bundle = createTestBundle();
  await hybridSync.commitProvisionalToBaseCache(bundle, ['op1', 'op1', 'op2']);
  
  // Verify op1 was only applied once despite appearing twice in committedOpIds
});
```

### Monitoring & Maintenance

#### Real-Time Duplicate Detection

- **Console Warnings**: Automatic logging when duplicates are prevented
- **Operation Tracking**: Every opId verified against existing records
- **Performance Monitoring**: Track duplicate detection overhead
- **Audit Logging**: Record all prevented duplicates for analysis

#### Operational Tools

- **StockDebugPanel**: Visual interface for detecting and fixing issues
- **Reconciliation Reports**: Automated analysis of stock discrepancies  
- **Cleanup Utilities**: Remove duplicate operations from provisional storage
- **Cache Validation**: Periodic integrity checks during sync

This stock integrity system ensures **VMStock** maintains accurate inventory levels in all multi-user scenarios, providing the reliability required for business-critical operations.

---


### Organization-Specific Payment Processing

**VMStock** integrates with **Stripe Terminal** for contactless payments, specifically enabled for the `vale-madrid-tuck-shop` organization on Android devices.

#### Technical Implementation

```typescript
// services/PaymentService.ts - Stripe Terminal Integration
interface StripeConfig {
  organizationId: string;
  publishableKey: string;
  locationId: string;
  enableTapToPay: boolean;
  supportedMethods: ('card_present' | 'interac_present')[];
}

// Organization-specific Stripe configuration
const STRIPE_CONFIGS: Record<string, StripeConfig> = {
  'vale-madrid-tuck-shop': {
    organizationId: 'vale-madrid-tuck-shop',
    publishableKey: 'pk_live_vale_madrid_key', // Production key
    locationId: 'tml_vale_madrid_location',
    enableTapToPay: true,
    supportedMethods: ['card_present', 'interac_present']
  }
  // Other organizations can be added here
};

class PaymentService {
  private stripeTerminal: StripeTerminal | null = null;
  private currentConfig: StripeConfig | null = null;

  // Initialize Stripe Terminal for organization
  async initializeStripeForOrganization(organizationId: string): Promise<boolean> {
    const config = STRIPE_CONFIGS[organizationId];
    if (!config) {
      console.log(`⚠️ Stripe not configured for organization: ${organizationId}`);
      return false;
    }

    try {
      // Initialize Stripe Terminal SDK
      await StripeTerminal.initialize({
        fetchConnectionToken: async () => {
          // Server-side connection token generation
          const response = await fetch('/api/stripe/connection-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId })
          });
          const { secret } = await response.json();
          return secret;
        }
      });

      this.currentConfig = config;
      console.log('✅ Stripe Terminal initialized for:', organizationId);
      return true;
    } catch (error) {
      console.error('❌ Stripe Terminal initialization failed:', error);
      return false;
    }
  }

  // Android Tap-to-Pay setup
  async enableTapToPayOnAndroid(): Promise<boolean> {
    if (!this.currentConfig?.enableTapToPay) {
      return false;
    }

    try {
      // Check if device supports NFC
      const isSupported = await StripeTerminal.isReaderSupported('tap_to_pay_android');
      if (!isSupported) {
        console.warn('⚠️ Device does not support Tap to Pay');
        return false;
      }

      // Discover Tap to Pay reader
      const reader = await StripeTerminal.discoverReaders({
        discoveryMethod: 'tap_to_pay',
        simulated: false
      });

      if (reader) {
        await StripeTerminal.connectReader(reader);
        console.log('✅ Tap to Pay enabled on Android');
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Tap to Pay setup failed:', error);
      return false;
    }
  }

  // Process contactless payment
  async processContactlessPayment(amount: number, currency: string = 'GBP'): Promise<PaymentResult> {
    if (!this.stripeTerminal || !this.currentConfig) {
      throw new Error('Stripe Terminal not initialized');
    }

    try {
      // Create payment intent
      const paymentIntent = await StripeTerminal.createPaymentIntent({
        amount: Math.round(amount * 100), // Stripe uses cents
        currency: currency.toLowerCase(),
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        metadata: {
          organizationId: this.currentConfig.organizationId,
          paymentType: 'tap_to_pay'
        }
      });

      // Collect payment method (NFC tap)
      const result = await StripeTerminal.collectPaymentMethod(paymentIntent);
      
      if (result.error) {
        throw new Error(result.error.message);
      }

      // Process payment
      const confirmation = await StripeTerminal.processPayment(result.paymentIntent);
      
      return {
        success: true,
        transactionId: confirmation.paymentIntent.id,
        amount,
        currency,
        method: 'tap_to_pay',
        timestamp: new Date().toISOString(),
        receiptData: confirmation.paymentIntent.charges?.data[0]
      };

    } catch (error) {
      console.error('❌ Contactless payment failed:', error);
      return {
        success: false,
        error: error.message,
        method: 'tap_to_pay'
      };
    }
  }

  // Integration with assignment payments
  async payAssignmentsWithStripe(assignmentIds: string[], playerId: string): Promise<void> {
    // Get total amount from assignments
    const assignments = await hybridSyncService.getAssignmentsWithOverlay();
    const targetAssignments = assignments.filter(a => assignmentIds.includes(a.id));
    const totalAmount = targetAssignments.reduce((sum, a) => sum + a.total, 0) / 100; // Convert from cents

    // Process Stripe payment
    const paymentResult = await this.processContactlessPayment(totalAmount);
    
    if (paymentResult.success) {
      // Mark assignments as paid through HybridSyncService
      for (const assignmentId of assignmentIds) {
        await hybridSyncService.applyOp({
          id: generateUUID(),
          type: 'update',
          collection: 'assignments',
          entityId: assignmentId,
          data: {
            paid: true,
            paidAt: new Date().toISOString(),
            paidBy: FirebaseAuth.currentUser?.uid,
            paymentMethod: 'stripe_tap_to_pay',
            stripeTransactionId: paymentResult.transactionId
          },
          metadata: {
            deviceId: this.deviceId,
            timestamp: Date.now(),
            version: 1,
            vectorClock: {},
            source: 'local'
          }
        });
      }

      console.log('✅ Assignments marked as paid via Stripe:', assignmentIds);
    }
  }
}
```

#### Setup Requirements

**For vale-madrid-tuck-shop organization:**

1. **Stripe Account Configuration**:
   ```typescript
   // Required Stripe setup
   - Stripe Account: vale-madrid-tuck-shop@stripe.com
   - Terminal Location: "Vale Madrid Tuck Shop - Main Location"  
   - API Keys: Production publishable/secret keys
   - Webhook Endpoint: For payment confirmations
   ```

2. **Android Device Requirements**:
   ```typescript
   // NFC-enabled Android device with:
   - Android 7.0+ (API level 24+)
   - NFC capability enabled
   - Location services enabled
   - Internet connectivity for payment processing
   ```

3. **Environment Variables**:
   ```bash
   # .env configuration for vale-madrid-tuck-shop
   STRIPE_ENABLED_ORGS=vale-madrid-tuck-shop
   STRIPE_VALE_MADRID_PUBLISHABLE_KEY=pk_live_...
   STRIPE_VALE_MADRID_SECRET_KEY=sk_live_...
   STRIPE_VALE_MADRID_LOCATION_ID=tml_...
   ```

#### Payment Flow Integration

```typescript
// components/PaymentModal.tsx - Updated for Stripe
export default function PaymentModal({ organizationId, amount, assignmentIds }: PaymentModalProps) {
  const [stripeEnabled, setStripeEnabled] = useState(false);
  
  useEffect(() => {
    // Check if Stripe is enabled for current organization
    if (organizationId === 'vale-madrid-tuck-shop') {
      paymentService.initializeStripeForOrganization(organizationId)
        .then(setStripeEnabled);
    }
  }, [organizationId]);

  const handleStripePayment = async () => {
    if (!stripeEnabled) return;
    
    try {
      await paymentService.payAssignmentsWithStripe(assignmentIds, playerId);
      onPaymentComplete({ success: true, method: 'stripe_tap_to_pay' });
    } catch (error) {
      Alert.alert('Payment Failed', error.message);
    }
  };

  return (
    <Modal visible={visible}>
      {/* Manual payment option (always available) */}
      <TouchableOpacity onPress={handleManualPayment}>
        <Text>Mark as Paid</Text>
      </TouchableOpacity>

      {/* Stripe Tap-to-Pay option (organization-specific) */}
      {stripeEnabled && (
        <TouchableOpacity onPress={handleStripePayment}>
          <Icon name="contactless-payment" size={24} />
          <Text>Pay with Card (Tap)</Text>
        </TouchableOpacity>
      )}
    </Modal>
  );
}
```

#### Benefits for Vale Madrid Tuck Shop

- **Professional Payment Processing**: Same technology used by Apple Stores
- **No Additional Hardware**: Uses device's built-in NFC
- **Secure Transactions**: PCI DSS compliant, encrypted end-to-end
- **Real-time Processing**: Instant payment confirmation
- **Receipt Generation**: Digital receipts via email/SMS
- **Offline Resilience**: Payments stored locally and synced when online
- **Audit Trail**: Complete transaction history in Stripe Dashboard

---

**VMStock v2.1** - Complete offline-first architecture with multi-user, multi-organization support built on Expo SDK 54, React v19, and Firebase v12.4.0.

*This document serves as the definitive guide for understanding and extending the VMStock application architecture.*