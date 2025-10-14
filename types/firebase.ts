// Type definitions for Firestore data models
// These interfaces define the structure of documents in your Firebase collections

import { Timestamp } from 'firebase/firestore';

// ===========================================
// ORGANIZATION TYPES
// ===========================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  adminUsers: string[];
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  settings: OrganizationSettings;
  subscription?: SubscriptionInfo;
}

export interface ChargeReason {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OrganizationSettings {
  currency: string;
  timezone: string;
  defaultTheme: 'light' | 'dark';
  businessHours: {
    start: string;
    end: string;
    days: number[];
  };
  features: {
    enableBarcodeScan: boolean;
    enablePushNotifications: boolean;
    enableOfflineMode: boolean;
    enableAdvancedReports: boolean;
  };
  // Legacy settings from context - keeping for compatibility
  allowNegativeBalance?: boolean;
  requireParentEmail?: boolean;
  autoSyncInterval?: number;
  // New charge reasons system
  chargeReasons?: ChargeReason[];
}

export interface SubscriptionInfo {
  plan: 'free' | 'basic' | 'premium';
  status: 'active' | 'cancelled' | 'expired';
  expiresAt: Timestamp;
}

// ===========================================
// USER TYPES
// ===========================================

export interface User {
  id: string;
  email?: string;
  phone?: string;
  displayName: string;
  
  role: UserRole;
  permissions: UserPermissions;
  
  isActive: boolean;
  lastLoginAt?: Timestamp;
  
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  profile: UserProfile;
}

export type UserRole = 'admin' | 'cashier' | 'viewer';

export interface UserPermissions {
  canManageProducts: boolean;
  canManageUsers: boolean;
  canMakeSales: boolean;
  canViewReports: boolean;
  canExportData: boolean;
}

export interface UserProfile {
  avatar?: string;
  position?: string;
  notes?: string;
}

// ===========================================
// PRODUCT TYPES
// ===========================================

export interface Product {
  id: string;
  name: string;
  description?: string;
  
  stock: number;
  minStockLevel: number;
  maxStockLevel?: number;
  
  price: number;
  cost?: number;
  
  category?: string;
  barcode?: string;
  sku?: string;
  
  isActive: boolean;
  isDeleted: boolean;
  
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  stats: ProductStats;
}

export interface ProductStats {
  totalSold: number;
  totalRevenue: number;
  lastSoldAt?: Timestamp;
}

// ===========================================
// PLAYER (CUSTOMER/STUDENT) TYPES
// ===========================================

export interface Player {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  
  balance: number;
  totalPurchases: number;
  totalSpent: number;
  
  isActive: boolean;
  grade?: string;
  studentId?: string;
  house?: string;
  
  assignedUserId?: string; // Staff user ID assigned to this player
  assignedUserEmail?: string;
  
  parentEmail?: string;
  parentPhone?: string;
  notes?: string;
  
  organizationId: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ===========================================
// ASSIGNMENT (SALES) TYPES
// ===========================================

export interface Assignment {
  id: string;
  
  playerId: string; // Links to Player collection (customers/students)
  playerName: string;
  productId: string;
  productName: string;
  
  quantity: number;
  unitPrice: number;
  total: number;
  
  paid: boolean;
  paidAt?: Timestamp;
  paidBy?: string; // Staff user ID who processed payment
  paidByUserName?: string; // Staff user name
  
  date: string; // DD.MM.YYYY format
  createdBy: string; // Staff user ID who created the assignment
  createdByUserName?: string; // Staff user name
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  organizationId: string;
  status?: 'pending' | 'completed' | 'cancelled';
  notes?: string;
  discount?: {
    amount: number;
    reason: string;
  };
}

// ===========================================
// CHARGE TYPES
// ===========================================

export interface Charge {
  id: string;
  playerId: string;
  playerName: string;
  
  amount: number; // Positive = charge to player, Negative = payment received
  reason: string; // References ChargeReason.id
  reasonName?: string; // For display purposes, will be populated from ChargeReason.name
  description?: string;
  
  date: string; // ISO string
  createdAt?: any; // Firestore timestamp
  updatedAt?: any; // Firestore timestamp
  
  organizationId: string;
  status: 'pending' | 'paid' | 'cancelled';
  
  metadata?: {
    deviceId: string;
    source: 'local' | 'server';
    timestamp: number;
    vectorClock: Record<string, number>;
    version: number;
  };
  
  // Optional reference to related assignment if charge is for an unpaid sale
  relatedAssignmentId?: string;
  
  notes?: string;
}

// ===========================================
// REPORT TYPES
// ===========================================

export interface DailyReport {
  id: string; // YYYY-MM-DD format
  date: string; // DD.MM.YYYY format
  
  totalRevenue: number;
  totalTransactions: number;
  totalItems: number;
  
  paidAmount: number;
  unpaidAmount: number;
  
  topProducts: TopProductStat[];
  cashierStats: CashierStat[];
  
  generatedAt: Timestamp;
  generatedBy: string;
}

export interface TopProductStat {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

export interface CashierStat {
  userId: string;
  userName: string;
  salesCount: number;
  totalRevenue: number;
}

// ===========================================
// SETTINGS TYPES
// ===========================================

export interface AppSettings {
  features: {
    offlineMode: boolean;
    pushNotifications: boolean;
    biometricAuth: boolean;
    barcodeScanning: boolean;
    advancedReports: boolean;
    exportData: boolean;
  };
  
  ui: {
    defaultTheme: 'light' | 'dark';
    currency: string;
    dateFormat: string;
    numberFormat: string;
  };
  
  business: {
    autoGenerateReports: boolean;
    lowStockAlertLevel: number;
    maxCreditLimit: number;
    requirePaymentConfirmation: boolean;
  };
  
  updatedBy: string;
  updatedAt: Timestamp;
}

// ===========================================
// UTILITY TYPES
// ===========================================

// For creating new documents (without generated fields)
export type CreateOrganization = Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateUser = Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'lastLoginAt'>;
export type CreateProduct = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'stats'>;
export type CreatePlayer = Omit<Player, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateAssignment = Omit<Assignment, 'id' | 'createdAt' | 'updatedAt'>;

// For updating documents (all fields optional except id)
export type UpdateOrganization = Partial<Omit<Organization, 'id' | 'createdAt'>> & { id: string; updatedAt: Timestamp };
export type UpdateUser = Partial<Omit<User, 'id' | 'createdAt'>> & { id: string; updatedAt: Timestamp };
export type UpdateProduct = Partial<Omit<Product, 'id' | 'createdAt'>> & { id: string; updatedAt: Timestamp };
export type UpdatePlayer = Partial<Omit<Player, 'id' | 'createdAt'>> & { id: string; updatedAt: Timestamp };
export type UpdateAssignment = Partial<Omit<Assignment, 'id' | 'createdAt'>> & { id: string; updatedAt: Timestamp };

// Query result types
export interface QueryResult<T> {
  data: T[];
  hasMore: boolean;
  lastDoc?: any; // Firestore document snapshot for pagination
}

// Error types
export interface FirestoreError {
  code: string;
  message: string;
  details?: any;
}

// Authentication types
export interface AuthUser {
  uid: string;
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  emailVerified: boolean;
}

// Real-time listener types
export type DocumentListener<T> = (data: T | null, error?: FirestoreError) => void;
export type CollectionListener<T> = (data: T[], error?: FirestoreError) => void;

// Migration types (for AsyncStorage to Firestore migration)
export interface MigrationData {
  products: any[];
  users: string[];
  assignments: any[];
  reports: any[];
}

export interface MigrationResult {
  success: boolean;
  errors: string[];
  migrated: {
    products: number;
    users: number;
    assignments: number;
    reports: number;
  };
}