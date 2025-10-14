# Firebase Data Schema Design

## 🏗️ **Firestore Collections Structure**

### **Multi-Tenant Architecture**
All data is organized under **organizations** to support multiple businesses using the same app.

```
/organizations/{orgId}/
├── users/
├── products/ 
├── assignments/
├── dailyReports/
└── settings/
```

---

## 📊 **Collection Schemas**

### **1. Organizations Collection**
```typescript
// /organizations/{orgId}
interface Organization {
  id: string;                    // Auto-generated document ID
  name: string;                  // "Vale Madrid Tuck Shop"
  slug: string;                  // "vale-madrid-tuck-shop" (URL-friendly)
  adminUsers: string[];          // Array of admin user IDs
  createdBy: string;             // User ID who created the org
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  // Organization settings
  settings: {
    currency: string;            // "GBP", "USD", etc.
    timezone: string;            // "Europe/London"
    defaultTheme: 'light' | 'dark';
    businessHours: {
      start: string;             // "09:00"
      end: string;               // "17:00"
      days: number[];            // [1,2,3,4,5] (Mon-Fri)
    };
    features: {
      enableBarcodeScan: boolean;
      enablePushNotifications: boolean;
      enableOfflineMode: boolean;
      enableAdvancedReports: boolean;
    };
  };
  
  // Subscription info (future)
  subscription?: {
    plan: 'free' | 'basic' | 'premium';
    status: 'active' | 'cancelled' | 'expired';
    expiresAt: Timestamp;
  };
}
```

### **2. Users Collection**
```typescript
// /organizations/{orgId}/users/{userId}
interface User {
  id: string;                    // Firebase Auth UID
  email?: string;                // Optional (some users may use phone only)
  phone?: string;                // Optional phone number
  displayName: string;           // "John Smith"
  
  // Role-based access control
  role: 'admin' | 'cashier' | 'viewer';
  permissions: {
    canManageProducts: boolean;
    canManageUsers: boolean;
    canMakeSales: boolean;
    canViewReports: boolean;
    canExportData: boolean;
  };
  
  // User status
  isActive: boolean;
  lastLoginAt?: Timestamp;
  
  // Metadata
  createdBy: string;             // Admin who added this user
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  // Profile info
  profile: {
    avatar?: string;             // Photo URL
    position?: string;           // "Manager", "Staff", etc.
    notes?: string;              // Admin notes about user
  };
}
```

### **3. Products Collection**
```typescript
// /organizations/{orgId}/products/{productId}
interface Product {
  id: string;                    // Auto-generated
  name: string;                  // "Coca Cola"
  description?: string;          // Optional description
  
  // Inventory
  quantity: number;              // Current stock count
  minStockLevel: number;         // Alert when below this
  maxStockLevel?: number;        // Optional max capacity
  
  // Pricing
  price: number;                 // Sale price (in smallest currency unit)
  cost?: number;                 // Cost price (for profit calculation)
  
  // Product details
  category?: string;             // "Drinks", "Snacks", etc.
  barcode?: string;              // For barcode scanning
  sku?: string;                  // Stock keeping unit
  
  // Status
  isActive: boolean;             // Can be sold
  isDeleted: boolean;            // Soft delete flag
  
  // Metadata
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  // Analytics
  stats: {
    totalSold: number;           // Lifetime sales count
    totalRevenue: number;        // Lifetime revenue
    lastSoldAt?: Timestamp;      // Last sale date
  };
}
```

### **4. Assignments (Sales) Collection**
```typescript
// /organizations/{orgId}/assignments/{assignmentId}
interface Assignment {
  id: string;                    // Auto-generated
  
  // Sale details
  userId: string;                // Customer/player ID (from users collection)
  userName: string;              // Cached user name for performance
  productId: string;             // Product ID
  productName: string;           // Cached product name
  
  // Transaction details
  quantity: number;              // Number of items sold
  unitPrice: number;             // Price per item at time of sale
  total: number;                 // quantity * unitPrice
  
  // Payment status
  paid: boolean;                 // Has customer paid?
  paidAt?: Timestamp;            // When payment was received
  paidBy?: string;               // User ID who processed payment
  
  // Transaction metadata
  date: string;                  // "DD.MM.YYYY" format (for reports)
  createdBy: string;             // Cashier who made the sale
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  // Optional fields
  notes?: string;                // Additional notes
  discount?: {
    amount: number;              // Discount applied
    reason: string;              // Why discount was given
  };
}
```

### **5. Daily Reports Collection**
```typescript
// /organizations/{orgId}/dailyReports/{date}
interface DailyReport {
  id: string;                    // Date in YYYY-MM-DD format
  date: string;                  // "DD.MM.YYYY" format (display)
  
  // Sales summary
  totalRevenue: number;          // Total money earned
  totalTransactions: number;     // Number of sales
  totalItems: number;            // Total items sold
  
  // Payment summary
  paidAmount: number;            // Money actually received
  unpaidAmount: number;          // Outstanding debt
  
  // Top products for the day
  topProducts: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
  }>;
  
  // User/cashier summary
  cashierStats: Array<{
    userId: string;
    userName: string;
    salesCount: number;
    totalRevenue: number;
  }>;
  
  // Metadata
  generatedAt: Timestamp;
  generatedBy: string;           // User who generated report
}
```

### **6. Settings Collection**
```typescript
// /organizations/{orgId}/settings/app
interface AppSettings {
  // Feature flags
  features: {
    offlineMode: boolean;
    pushNotifications: boolean;
    biometricAuth: boolean;
    barcodeScanning: boolean;
    advancedReports: boolean;
    exportData: boolean;
  };
  
  // UI settings
  ui: {
    defaultTheme: 'light' | 'dark';
    currency: string;
    dateFormat: string;
    numberFormat: string;
  };
  
  // Business logic
  business: {
    autoGenerateReports: boolean;
    lowStockAlertLevel: number;
    maxCreditLimit: number;
    requirePaymentConfirmation: boolean;
  };
  
  updatedBy: string;
  updatedAt: Timestamp;
}
```

---

## 🔍 **Firestore Indexes Required**

### **Composite Indexes:**
```javascript
// For efficient queries
collections.assignments: {
  fields: ['userId', 'paid', 'createdAt'],
  order: 'desc'
}

collections.assignments: {
  fields: ['date', 'paid'],
  order: 'desc'
}

collections.products: {
  fields: ['isActive', 'quantity'],
  order: 'asc'
}

collections.users: {
  fields: ['isActive', 'role', 'createdAt'],
  order: 'desc'
}
```

---

## 🛡️ **Security Rules Preview**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Organization-level security
    match /organizations/{orgId} {
      // Only org admins can read/write org settings
      allow read, write: if isOrgAdmin(resource, request.auth.uid);
      
      // All org members can read basic org info
      allow read: if isOrgMember(orgId, request.auth.uid);
      
      // Nested collection rules
      match /{collection}/{docId} {
        // Allow if user is active member of this organization
        allow read, write: if isActiveOrgMember(orgId, request.auth.uid);
      }
    }
    
    // Helper functions
    function isOrgAdmin(resource, uid) {
      return uid != null && resource.data.adminUsers.hasAny([uid]);
    }
    
    function isActiveOrgMember(orgId, uid) {
      return uid != null && 
        get(/databases/$(database)/documents/organizations/$(orgId)/users/$(uid)).data.isActive == true;
    }
  }
}
```

---

## 📈 **Data Relationships**

```
Organization (1) ─→ (Many) Users
Organization (1) ─→ (Many) Products  
Organization (1) ─→ (Many) Assignments
Organization (1) ─→ (Many) DailyReports

User (1) ─→ (Many) Assignments (as customer)
Product (1) ─→ (Many) Assignments (as item sold)
Assignment (Many) ─→ (1) DailyReport (grouped by date)
```

---

## 🚀 **Migration Strategy**

### **Phase 1: Create Collections**
1. Create organization document
2. Migrate users with default roles
3. Migrate products with analytics stats
4. Convert assignments to new schema

### **Phase 2: Data Enrichment**
1. Calculate product statistics
2. Generate historical daily reports
3. Set up user permissions based on current usage
4. Create default settings

This schema supports your current functionality while enabling future features like multi-tenancy, advanced reporting, and role-based access control.