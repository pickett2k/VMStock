import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseService, FirebaseService } from './FirebaseService';
import { FirebaseAuth } from '../config/firebase';
import { generateUUID } from '../utils/uuid';

interface SyncQueueItem {
  id: string;
  action: 'create' | 'update' | 'delete' | 'updateBalance';
  collection: 'products' | 'staff-users' | 'assignments' | 'players' | 'reports' | 'charges' | 'organizations';
  data: any;
  timestamp: number;
  retryCount: number;
  // Batch grouping for related operations
  batchId?: string;
  batchLabel?: string; // User-friendly label like "Assignment Sale"
}

// Unified Operation Interface - Single Source of Truth for All Writes
interface Operation {
  id: string;
  type: 'create' | 'update' | 'delete' | 'updateBalance' | 'createAssignmentTransaction';
  collection: 'products' | 'staff-users' | 'assignments' | 'players' | 'reports' | 'charges' | 'organizations';
  entityId?: string;
  data: any;
  metadata: {
    deviceId: string;
    timestamp: number | string; // Allow both number (ms) and string (ISO) for compatibility
    version: number;
    vectorClock: Record<string, number>;
    userId?: string;
    source: 'local' | 'server' | 'sync';
  };
}

export class HybridSyncService {
  private syncQueue: SyncQueueItem[] = [];
  private isOnline: boolean = true;
  private isSyncing: boolean = false;
  private syncStartTime: number = 0;
  private syncQueueKey = 'sync_queue';
  private maxRetries = 3; // Only for REAL failures
  private maxNetworkRetries = 15; // More lenient for network issues (poor signal, etc.)
  private syncInterval: any = null;
  private highPriorityInterval: any = null;
  private conflictDetectionInterval: any = null;
  private deadLetterInterval: any = null;
  private stuckSyncInterval: any = null;
  private serverChangesInterval: any = null;
  private deviceId: string;
  private vectorClock: Map<string, number> = new Map();
  private processedIds: Set<string> = new Set(); // Idempotency tracking
  private deadLetterQueue: SyncQueueItem[] = [];
  private batchSize = 10; // Process items in batches for better performance
  private forceServerMode: boolean = false; // Temporarily bypass conflict resolution on login

  constructor() {
    // Initialize device-specific vector clock
    this.deviceId = this.generateDeviceId();
    
    this.initializeNetworkListener();
    this.loadSyncQueue();
    this.initializeVectorClock(); // Async initialization
    this.startBackgroundSync();
  }

  // ============================================
  // SINGLE SOURCE OF TRUTH - UNIFIED WRITE PATH
  // ============================================

  /**
   * applyOp - The ONLY way to write data in the system
   * 
   * ALL writes must go through this function to ensure:
   * 1. Local cache is updated first (truth always local)
   * 2. Consistent version bumping and timestamps
   * 3. Proper conflict resolution rules
   * 4. Outbox queue management
   * 5. Server hydration happens after local success
   */
  public async applyOp(operation: Operation): Promise<void> {
    console.log('📝 applyOp - Single write path:', {
      type: operation.type,
      collection: operation.collection,
      entityId: operation.entityId,
      source: operation.metadata.source,
      online: this.isOnline,
      timestamp: operation.metadata.timestamp,
      timestampType: typeof operation.metadata.timestamp
    });

    // Special logging for player create operations
    if (operation.collection === 'players' && operation.type === 'create') {
      console.log('🎯 APPLY OP - Player creation detected:', {
        playerId: operation.entityId,
        playerName: operation.data?.name || `${operation.data?.firstName} ${operation.data?.lastName}`,
        isOnline: this.isOnline,
        willSync: this.isOnline && operation.metadata.source === 'local',
        operationId: operation.id
      });
    }

    try {
      // Validate operation structure
      if (!operation.metadata || operation.metadata.timestamp === undefined) {
        throw new Error('Invalid operation: missing metadata or timestamp');
      }

      // Step 1: ALWAYS update local cache first (truth is local)
      await this.applyOpToLocalCache(operation);
      
      // Step 2: Add to outbox for server sync (if not from server)
      if (operation.metadata.source !== 'server') {
        await this.addOpToOutbox(operation);
      }
      
      // Step 3: Attempt immediate server sync if online (best effort)
      if (this.isOnline && operation.metadata.source === 'local') {
        try {
          await this.syncOpToServer(operation);
          // If immediate sync succeeds, remove from outbox to prevent duplicate
          await this.removeOpFromOutbox(operation.id);
          console.log('✅ Operation synced immediately and removed from outbox:', operation.id);
        } catch (error) {
          console.warn('⚠️ Immediate server sync failed, will retry via outbox:', error);
          // Don't throw - local cache is already updated, outbox will handle retry
        }
      }
      
      console.log('✅ applyOp completed successfully');
      
    } catch (error) {
      console.error('❌ applyOp failed:', error);
      console.error('❌ Operation details:', {
        type: operation.type,
        collection: operation.collection,
        entityId: operation.entityId,
        metadata: operation.metadata
      });
      throw error;
    }
  }

  // ============================================
  // BUNDLE OPERATIONS (ATOMIC TRANSACTIONS)
  // ============================================

  /**
   * Create assignment as atomic bundle (implementing MD specification)
   */
  public async createAssignmentBundle(input: {
    assignmentId?: string;
    productId: string;
    productName: string;
    playerId: string;
    userName: string;
    quantity: number;
    unitPrice: number;
    total: number;
    organizationId: string;
  }): Promise<string> {
    // Validate required inputs
    if (!input.productId || !input.playerId || !input.organizationId) {
      throw new Error('Missing required fields for assignment bundle');
    }
    
    console.log('🎯 Creating assignment bundle:', {
      productId: input.productId,
      playerId: input.playerId,
      quantity: input.quantity,
      total: input.total
    });
    
    const bundleId = input.assignmentId ?? generateUUID();
    const steps = [
      { 
        opId: this.hashBundleStep(bundleId, 'createAssignment'), 
        kind: 'createAssignment' as const, 
        payload: {
          id: bundleId, // Use 'id' for consistency with Firebase service
          assignmentId: bundleId, // Keep both for compatibility
          productId: input.productId,
          productName: input.productName,
          userName: input.userName,
          playerId: input.playerId,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          total: input.total,
          date: new Date().toISOString(),
          paid: false,
          organizationId: input.organizationId,
        }
      },
      { 
        opId: this.hashBundleStep(bundleId, 'stockDelta'), 
        kind: 'stockDelta' as const, 
        payload: {
          productId: input.productId,
          delta: -Math.abs(input.quantity), // sale decrements stock
        }
      },
      { 
        opId: this.hashBundleStep(bundleId, 'balanceDelta'), 
        kind: 'balanceDelta' as const, 
        payload: {
          playerId: input.playerId,
          delta: +Math.abs(input.total), // debit to player (positive = debt)
        }
      },
    ];

    const bundle = {
      bundleId,
      type: 'assignmentSale' as const,
      entityRefs: { assignmentId: bundleId, productId: input.productId, playerId: input.playerId },
      steps,
      vectorClock: await this.getBumpedVectorClock(),
      timestamp: Date.now(),
      source: 'local' as const,
    };

    // 1) Apply locally as provisional overlay
    await this.applyBundleLocally(bundle);

    // 2) Enqueue for sync (outbox)
    await this.enqueueBundleForSync(bundle);

    // 3) Best-effort immediate sync
    if (this.isOnline) {
      try {
        await this.processSingleBundle(bundle);
        console.log('✅ Bundle synced immediately:', bundleId);
      } catch (error) {
        console.warn('⚠️ Immediate bundle sync failed, will retry via outbox:', error);
      }
    }

    return bundleId;
  }

  public async createChargeBundle(input: {
    chargeId?: string;
    playerId: string;
    playerName: string;
    amount: number; // Positive = charge to player, Negative = payment received
    reason: 'owedSale' | 'fine' | 'regularFee' | 'payment' | 'refund' | 'other';
    reasonName?: string;
    reasonDescription?: string;
    organizationId: string;
    relatedAssignmentId?: string;
    notes?: string;
  }): Promise<string> {
    // Validate required inputs
    if (!input.playerId || !input.organizationId || input.amount === 0) {
      throw new Error('Missing required fields for charge bundle');
    }
    
    console.log('💰 Creating charge bundle:', {
      playerId: input.playerId,
      playerName: input.playerName,
      amount: input.amount,
      reason: input.reason
    });

    const bundleId = input.chargeId || generateUUID();
    
    const steps = [
      { 
        opId: this.hashBundleStep(bundleId, 'createCharge'), 
        kind: 'createCharge' as const, 
        payload: {
          id: bundleId,
          playerId: input.playerId,
          playerName: input.playerName,
          amount: input.amount,
          reason: input.reason,
          reasonName: input.reasonName,
          reasonDescription: input.reasonDescription,
          date: new Date().toISOString(),
          organizationId: input.organizationId,
          status: input.amount > 0 ? 'pending' : 'paid', // Positive amounts are charges (pending), negative are payments (paid)
          ...(input.relatedAssignmentId && { relatedAssignmentId: input.relatedAssignmentId }),
          notes: input.notes,
        }
      },
      { 
        opId: this.hashBundleStep(bundleId, 'balanceDelta'), 
        kind: 'balanceDelta' as const, 
        payload: {
          playerId: input.playerId,
          delta: +Math.abs(input.amount) * (input.amount > 0 ? 1 : -1), // Positive = debt increase, Negative = debt decrease
        }
      },
    ];

    const bundle = {
      bundleId,
      type: 'charge' as const,
      entityRefs: { chargeId: bundleId, playerId: input.playerId },
      steps,
      vectorClock: await this.getBumpedVectorClock(),
      timestamp: Date.now(),
      source: 'local' as const,
    };

    console.log('📦 Charge bundle created:', {
      bundleId,
      steps: steps.length,
      entityRefs: bundle.entityRefs
    });

    // 1) Apply locally as provisional overlay
    await this.applyBundleLocally(bundle);

    // 2) Enqueue for sync (outbox)
    await this.enqueueBundleForSync(bundle);

    // 3) Best-effort immediate sync
    if (this.isOnline) {
      try {
        await this.processSingleBundle(bundle);
        console.log('✅ Charge bundle synced immediately:', bundleId);
      } catch (error) {
        console.warn('⚠️ Immediate charge bundle sync failed, will retry via outbox:', error);
      }
    }

    return bundleId;
  }

  /**
   * Update charge status (mark as paid/unpaid)
   */
  public async updateChargeStatus(chargeId: string, status: 'paid' | 'pending'): Promise<void> {
    try {
      console.log('🔄 Updating charge status:', { chargeId, status });
      
      // Get the charge details to create balance delta if marking as paid
      const charges = await this.getChargesWithOverlay();
      const charge = charges.find(c => c.id === chargeId);
      
      if (!charge) {
        throw new Error(`Charge not found: ${chargeId}`);
      }
      
      // Create an update bundle for the charge
      const bundleId = generateUUID();
      const steps: any[] = [
        {
          opId: this.hashBundleStep(bundleId, 'updateCharge'),
          kind: 'updateCharge' as const,
          payload: {
            chargeId,
            updates: { status },
            timestamp: Date.now()
          }
        }
      ];
      
      // If marking as paid, also add a balance delta to reduce the player's balance
      if (status === 'paid' && charge.status !== 'paid') {
        steps.push({
          opId: this.hashBundleStep(bundleId, 'balanceDelta'),
          kind: 'balanceDelta' as const,
          payload: {
            playerId: charge.playerId,
            delta: -charge.amount, // Negative to reduce balance
            timestamp: Date.now(),
            reason: 'charge-paid',
            description: `Charge payment: ${charge.reasonName || charge.reason}`,
            metadata: { chargeId, originalAmount: charge.amount }
          }
        });
        console.log('💰 Adding balance delta for paid charge:', { 
          playerId: charge.playerId, 
          delta: -charge.amount,
          chargeAmount: charge.amount
        });
      }
      
      // If marking as pending (unpaid) when it was previously paid, add balance delta to increase balance
      if (status === 'pending' && charge.status === 'paid') {
        steps.push({
          opId: this.hashBundleStep(bundleId, 'balanceDelta'),
          kind: 'balanceDelta' as const,
          payload: {
            playerId: charge.playerId,
            delta: charge.amount, // Positive to increase balance
            timestamp: Date.now(),
            reason: 'charge-unpaid',
            description: `Charge reversed: ${charge.reasonName || charge.reason}`,
            metadata: { chargeId, originalAmount: charge.amount }
          }
        });
        console.log('💰 Adding balance delta for unpaid charge:', { 
          playerId: charge.playerId, 
          delta: charge.amount,
          chargeAmount: charge.amount
        });
      }

      const bundle = {
        bundleId,
        type: 'chargeUpdate' as const,
        entityRefs: { chargeId },
        steps,
        vectorClock: await this.getBumpedVectorClock(),
        timestamp: Date.now(),
        source: 'local' as const,
      };

      // Apply locally and sync
      await this.applyBundleLocally(bundle);
      await this.enqueueBundleForSync(bundle);

      // Best-effort immediate sync
      if (this.isOnline) {
        try {
          await this.processSingleBundle(bundle);
          console.log('✅ Charge status update synced immediately:', chargeId);
        } catch (error) {
          console.warn('⚠️ Immediate charge status sync failed, will retry via outbox:', error);
        }
      }
    } catch (error) {
      console.error('❌ Error updating charge status:', error);
      throw error;
    }
  }

  /**
   * Delete a charge
   */
  public async deleteCharge(chargeId: string): Promise<void> {
    try {
      console.log('🗑️ Deleting charge:', { chargeId });
      
      // Create a delete bundle for the charge
      const bundleId = generateUUID();
      const steps = [
        {
          opId: this.hashBundleStep(bundleId, 'deleteCharge'),
          kind: 'deleteCharge' as const,
          payload: {
            chargeId,
            timestamp: Date.now()
          }
        }
      ];

      const bundle = {
        bundleId,
        type: 'chargeDelete' as const,
        entityRefs: { chargeId },
        steps,
        vectorClock: await this.getBumpedVectorClock(),
        timestamp: Date.now(),
        source: 'local' as const,
      };

      // Apply locally and sync
      await this.applyBundleLocally(bundle);
      await this.enqueueBundleForSync(bundle);

      // Best-effort immediate sync
      if (this.isOnline) {
        try {
          await this.processSingleBundle(bundle);
          console.log('✅ Charge deletion synced immediately:', chargeId);
        } catch (error) {
          console.warn('⚠️ Immediate charge deletion sync failed, will retry via outbox:', error);
        }
      }
    } catch (error) {
      console.error('❌ Error deleting charge:', error);
      throw error;
    }
  }

  /**
   * Create payment bundle for marking multiple assignments as paid (implementing MD specification)
   */
  public async createPaymentBundle(input: {
    playerId: string;
    playerName: string;
    assignmentIds: string[];
    totalAmount: number;
    paymentMethod?: 'manual' | 'stripe';
  }): Promise<string> {
    if (!input.playerId || !input.assignmentIds?.length || !input.totalAmount) {
      throw new Error('Missing required fields for payment bundle');
    }

    console.log('💰 Creating payment bundle:', {
      playerId: input.playerId,
      playerName: input.playerName,
      assignmentCount: input.assignmentIds.length,
      totalAmount: input.totalAmount,
      paymentMethod: input.paymentMethod || 'manual'
    });

    const bundleId = generateUUID();

    // Create bundle steps for all assignment updates + balance adjustment
    const steps = [
      // Step 1: Mark all assignments as paid
      ...input.assignmentIds.map((assignmentId, index) => ({
        opId: this.hashBundleStep(bundleId, `markPaid_${index}`),
        kind: 'updateAssignment' as const,
        assignment: {
          assignmentId,
          paid: true,
          paidAt: new Date().toISOString(),
          paymentMethod: input.paymentMethod || 'manual'
        }
      })),
      // Step 2: Update player balance (credit - payment received)
      {
        opId: this.hashBundleStep(bundleId, 'updateBalance'),
        kind: 'updatePlayerBalance' as const,
        player: {
          playerId: input.playerId,
          balanceDelta: -input.totalAmount, // Negative = credit (payment received)
          reason: `Payment received: £${input.totalAmount.toFixed(2)}`
        }
      }
    ];

    const bundle = {
      bundleId,
      type: 'playerPayment' as const,
      entityRefs: { 
        playerId: input.playerId, 
        assignmentIds: input.assignmentIds,
        totalAmount: input.totalAmount 
      },
      steps,
      vectorClock: await this.getBumpedVectorClock(),
      timestamp: Date.now(),
      source: 'local' as const,
    };

    console.log('💰 Payment bundle created:', {
      bundleId,
      steps: steps.length,
      assignmentUpdates: input.assignmentIds.length,
      balanceAdjustment: -input.totalAmount
    });

    // 1) Apply locally as provisional overlay
    await this.applyBundleLocally(bundle);

    // 2) Enqueue for sync (outbox)
    await this.enqueueBundleForSync(bundle);

    // 3) Best-effort immediate sync
    if (this.isOnline) {
      try {
        await this.processSingleBundle(bundle);
        console.log('✅ Payment bundle synced immediately:', bundleId);
      } catch (error) {
        console.warn('⚠️ Immediate payment bundle sync failed, will retry via outbox:', error);
      }
    }

    return bundleId;
  }

  /**
   * Create organization update bundle (for settings changes)
   */
  public async createOrganizationUpdateBundle(organizationUpdates: {
    name?: string;
    currency?: string;
    logoUrl?: string;
    description?: string;
    [key: string]: any;
  }): Promise<string> {
    if (!organizationUpdates || Object.keys(organizationUpdates).length === 0) {
      throw new Error('No organization updates provided');
    }

    console.log('🏢 Creating organization update bundle:', organizationUpdates);

    const bundleId = generateUUID();

    // Create bundle step for organization update
    const steps = [{
      opId: this.hashBundleStep(bundleId, 'updateOrganization'),
      kind: 'updateOrganization' as const,
      organization: organizationUpdates
    }];

    const bundle = {
      bundleId,
      type: 'organizationUpdate' as const,
      entityRefs: { 
        organizationUpdates
      },
      steps,
      vectorClock: await this.getBumpedVectorClock(),
      timestamp: Date.now(),
      source: 'local' as const,
    };

    console.log('🏢 Organization update bundle created:', {
      bundleId,
      updates: Object.keys(organizationUpdates),
    });

    // 1) Apply locally as provisional overlay
    await this.applyBundleLocally(bundle);

    // 2) Enqueue for sync (outbox)
    await this.enqueueBundleForSync(bundle);

    // 3) Best-effort immediate sync
    if (this.isOnline) {
      try {
        await this.processSingleBundle(bundle);
        console.log('✅ Organization update bundle synced immediately:', bundleId);
      } catch (error) {
        console.warn('⚠️ Immediate organization update bundle sync failed, will retry via outbox:', error);
      }
    }

    return bundleId;
  }

  /**
   * Apply bundle to local provisional state
   */
  private async applyBundleLocally(bundle: any): Promise<void> {
    console.log('📝 Applying bundle locally (provisional):', bundle.bundleId);

    for (const step of bundle.steps) {
      switch (step.kind) {
        case 'createAssignment':
          // Store assignment in provisional state
          await this.addProvisionalAssignment(step.payload.assignmentId, step);
          break;
        case 'stockDelta':
          // Add to provisional stock deltas
          await this.addProvisionalStockDelta(step.payload.productId, step.payload.delta, step.opId);
          break;
        case 'balanceDelta':
          // Add to provisional balance deltas
          await this.addProvisionalBalanceDelta(step.payload.playerId, step.payload.delta, step.opId, bundle.type);
          break;
        case 'updateAssignment':
          // Update assignment in provisional state (for payment marking)
          await this.addProvisionalAssignmentUpdate(step.assignment.assignmentId, step.assignment, step.opId);
          break;
        case 'updatePlayerBalance':
          // Add to provisional balance deltas (for payment processing)
          await this.addProvisionalBalanceDelta(step.player.playerId, step.player.balanceDelta, step.opId, bundle.type);
          break;
        case 'updateOrganization':
          // Update organization in provisional state (for settings changes)
          await this.addProvisionalOrganizationUpdate(step.organization, step.opId);
          break;
        case 'createCharge':
          // Store charge in provisional state
          await this.addProvisionalCharge(step.payload.id, step);
          break;
        case 'updateCharge':
          // Update charge in provisional state
          await this.updateProvisionalCharge(step.payload.chargeId, step.payload.updates);
          break;
        case 'deleteCharge':
          // Remove charge from provisional state
          await this.removeProvisionalCharge(step.payload.chargeId);
          break;
      }
    }

    await this.persistProvisionalState();
  }

  /**
   * Generate deterministic opId for bundle step
   */
  private hashBundleStep(bundleId: string, stepName: string): string {
    // Validate inputs to prevent indexOf errors
    if (!bundleId || typeof bundleId !== 'string') {
      throw new Error('Invalid bundleId for hash generation');
    }
    if (!stepName || typeof stepName !== 'string') {
      throw new Error('Invalid stepName for hash generation');
    }
    
    // Simple hash implementation - in production, use crypto.subtle or similar
    const combined = `${bundleId}:${stepName}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `opId_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Process single bundle for sync
   */
  private async processSingleBundle(bundle: any): Promise<void> {
    console.log('🔥 Processing bundle with Firebase atomic transaction:', bundle.bundleId);
    console.log('📊 Bundle details:', {
      bundleId: bundle.bundleId,
      type: bundle.type,
      stepCount: bundle.steps?.length || 0,
      steps: bundle.steps?.map((step: any) => ({
        kind: step.kind,
        opId: step.opId,
        payloadKeys: step.payload ? Object.keys(step.payload) : 'NO PAYLOAD'
      })) || 'NO STEPS'
    });
    
    try {
      // Use the global firebaseService instance that has the organization ID set
      if (!firebaseService.isReady()) {
        throw new Error('FirebaseService is not ready. Organization ID not set.');
      }
      const acks = await firebaseService.applyBundleTransaction(bundle);
      
      console.log('✅ Bundle processed successfully:', {
        bundleId: bundle.bundleId,
        stepsProcessed: acks.length,
        acks
      });
      
      // Mark provisional items as committed (would be implemented later)
      await this.commitProvisionalItems(bundle, acks);
      
    } catch (error) {
      console.error('❌ Bundle processing failed:', {
        bundleId: bundle.bundleId,
        bundleType: bundle.type,
        stepCount: bundle.steps?.length || 0,
        stepKinds: bundle.steps?.map((s: any) => s.kind) || 'NO STEPS',
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : 'No stack trace'
      });
      
      // Log individual step details for debugging
      if (bundle.steps && bundle.steps.length > 0) {
        console.error('📝 Failed bundle step details:');
        bundle.steps.forEach((step: any, index: number) => {
          console.error(`  Step ${index + 1}:`, {
            kind: step.kind,
            opId: step.opId,
            hasPayload: !!step.payload,
            payloadKeys: step.payload ? Object.keys(step.payload) : 'NO PAYLOAD'
          });
        });
      }
      
      throw error;
    }
  }

  /**
   * Add assignment to base cache
   */
  private async addAssignmentToBaseCache(assignmentData: any): Promise<void> {
    const assignments = await this.getLocalData('assignments');
    const existingIndex = assignments.findIndex((a: any) => a.id === assignmentData.id || a.id === assignmentData.assignmentId);
    
    if (existingIndex === -1) {
      assignments.push(assignmentData);
      await this.saveLocalData('assignments', assignments);
      console.log('✅ Assignment added to base cache:', assignmentData.id || assignmentData.assignmentId);
    }
  }

  /**
   * Add charge to base cache
   */
  private async addChargeToBaseCache(chargeData: any): Promise<void> {
    const charges = await this.getLocalData('charges');
    const existingIndex = charges.findIndex((c: any) => c.id === chargeData.id);
    
    if (existingIndex === -1) {
      charges.push(chargeData);
      await this.saveLocalData('charges', charges);
      console.log('✅ Charge added to base cache:', chargeData.id);
    }
  }

  private async updateChargeInBaseCache(chargeId: string, updates: any): Promise<void> {
    const charges = await this.getLocalData('charges');
    const chargeIndex = charges.findIndex((c: any) => c.id === chargeId);
    
    if (chargeIndex !== -1) {
      charges[chargeIndex] = { ...charges[chargeIndex], ...updates };
      await this.saveLocalData('charges', charges);
      console.log('✅ Charge updated in base cache:', { chargeId, updates });
    }
  }

  private async removeChargeFromBaseCache(chargeId: string): Promise<void> {
    const charges = await this.getLocalData('charges');
    const filteredCharges = charges.filter((c: any) => c.id !== chargeId);
    
    if (filteredCharges.length !== charges.length) {
      await this.saveLocalData('charges', filteredCharges);
      console.log('✅ Charge removed from base cache:', chargeId);
    }
  }

  /**
   * Apply stock delta to base cache
   */
  private async applyStockDeltaToBaseCache(productId: string, delta: number): Promise<void> {
    const products = await this.getLocalData('products');
    const product = products.find((p: any) => p.id === productId);
    
    if (product) {
      product.stock = (product.stock || 0) + delta;
      await this.saveLocalData('products', products);
      console.log('✅ Stock delta applied to base cache:', { productId, delta, newStock: product.stock });
    }
  }

  /**
   * Apply balance delta to base cache
   */
  private async applyBalanceDeltaToBaseCache(playerId: string, delta: number, isPurchase: boolean = true): Promise<void> {
    const players = await this.getLocalData('players');
    const player = players.find((p: any) => p.id === playerId);
    
    if (player) {
      player.balance = (player.balance || 0) + delta;
      
      // Only increment totalSpent and totalPurchases for actual purchases, not charges
      if (isPurchase && delta > 0) {
        player.totalSpent = (player.totalSpent || 0) + delta;
        player.totalPurchases = (player.totalPurchases || 0) + 1;
        console.log('✅ Balance delta applied to base cache (PURCHASE):', { playerId, delta, newBalance: player.balance, totalSpent: player.totalSpent });
      } else {
        console.log('✅ Balance delta applied to base cache (CHARGE/PAYMENT):', { playerId, delta, newBalance: player.balance, note: 'totalSpent/totalPurchases unchanged' });
      }
      
      await this.saveLocalData('players', players);
    }
  }

  private async applyAssignmentUpdateToBaseCache(assignmentId: string, updates: any): Promise<void> {
    const assignments = await this.getLocalData('assignments');
    const assignment = assignments.find((a: any) => a.id === assignmentId);
    
    if (assignment) {
      Object.assign(assignment, updates);
      await this.saveLocalData('assignments', assignments);
      console.log('✅ Assignment update applied to base cache:', { assignmentId, updates });
    }
  }

  /**
   * Commit provisional data to base cache (move from overlay to base)
   */
  private async commitProvisionalToBaseCache(bundle: any, committedOpIds: string[]): Promise<void> {
    console.log('💾 Committing provisional data to base cache:', committedOpIds);
    
    // 🔒 DEDUPLICATION: Track already committed operations to prevent double-commits
    const alreadyCommitted = new Set<string>();
    
    try {
      for (const step of bundle.steps) {
        if (!committedOpIds.includes(step.opId)) continue;
        
        // 🚨 CRITICAL FIX: Prevent duplicate commits to base cache
        if (alreadyCommitted.has(step.opId)) {
          console.warn(`🚨 Skipping duplicate commit for opId: ${step.opId}`);
          continue;
        }
        alreadyCommitted.add(step.opId);
        
        switch (step.kind) {
          case 'createAssignment':
            // Add assignment to base cache
            await this.addAssignmentToBaseCache(step.payload);
            break;
            
          case 'stockDelta':
            // Apply stock delta to base cache
            await this.applyStockDeltaToBaseCache(step.payload.productId, step.payload.delta);
            break;
            
          case 'balanceDelta':
            // Apply balance delta to base cache - charges should not count as purchases
            const isChargeBundle = bundle.type === 'charge';
            await this.applyBalanceDeltaToBaseCache(step.payload.playerId, step.payload.delta, !isChargeBundle);
            break;
            
          case 'updateAssignment':
            // Apply assignment update to base cache (for payment marking)
            await this.applyAssignmentUpdateToBaseCache(step.assignment.assignmentId, step.assignment);
            break;
            
          case 'updatePlayerBalance':
            // Apply balance delta to base cache (for payment processing) - payments should not count as purchases
            await this.applyBalanceDeltaToBaseCache(step.player.playerId, step.player.balanceDelta, false);
            break;
            
          case 'createCharge':
            // Add charge to base cache
            await this.addChargeToBaseCache(step.payload);
            break;
            
          case 'updateCharge':
            // Update charge in base cache
            await this.updateChargeInBaseCache(step.payload.chargeId, step.payload.updates);
            break;
            
          case 'deleteCharge':
            // Remove charge from base cache
            await this.removeChargeFromBaseCache(step.payload.chargeId);
            break;
        }
      }
      
      console.log('✅ Provisional data committed to base cache');
      
    } catch (error) {
      console.error('❌ Failed to commit provisional data to base cache:', error);
      throw error;
    }
  }

  /**
   * Mark provisional items as committed and clean up
   */
  private async commitProvisionalItems(bundle: any, acks: any[]): Promise<void> {
    console.log('📝 Committing provisional items for bundle:', bundle.bundleId);
    
    try {
      // Extract opIds from successful acks
      const committedOpIds = acks
        .filter(ack => !ack.skipped)
        .map(ack => ack.opId);
      
      if (committedOpIds.length > 0) {
        // CRITICAL: Commit provisional data to base cache BEFORE clearing
        await this.commitProvisionalToBaseCache(bundle, committedOpIds);
        
        // Then clear provisional overlays
        await this.clearProvisionalData(committedOpIds);
      }
      
      console.log('✅ Provisional items committed and cleaned up:', committedOpIds);
      
    } catch (error) {
      console.error('❌ Failed to commit provisional items:', error);
    }
  }

  /**
   * Convert bundle to individual operations (temporary bridge)
   */
  private bundleToOperations(bundle: any): Operation[] {
    const operations: Operation[] = [];
    
    for (const step of bundle.steps) {
      switch (step.kind) {
        case 'createAssignment':
          operations.push({
            id: step.opId,
            type: 'create',
            collection: 'assignments',
            entityId: step.payload.id || step.payload.assignmentId, // Use id first, fallback to assignmentId
            data: step.payload,
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        case 'stockDelta':
          operations.push({
            id: step.opId,
            type: 'update',
            collection: 'products',
            entityId: step.payload.productId,
            data: { stockDelta: step.payload.delta },
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        case 'balanceDelta':
          operations.push({
            id: step.opId,
            type: 'updateBalance',
            collection: 'players',
            entityId: step.payload.playerId,
            data: { 
              amount: Math.abs(step.payload.delta), 
              isDebit: step.payload.delta > 0 // positive delta = debit (owed money)
            },
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        case 'updateAssignment':
          operations.push({
            id: step.opId,
            type: 'update',
            collection: 'assignments',
            entityId: step.assignment.assignmentId,
            data: step.assignment,
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        case 'updatePlayerBalance':
          operations.push({
            id: step.opId,
            type: 'updateBalance',
            collection: 'players',
            entityId: step.player.playerId,
            data: { 
              amount: Math.abs(step.player.balanceDelta), 
              isDebit: step.player.balanceDelta > 0
            },
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        case 'updateOrganization':
          operations.push({
            id: step.opId,
            type: 'update',
            collection: 'organizations',
            entityId: step.organization.id,
            data: step.organization,
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        case 'createCharge':
          operations.push({
            id: step.opId,
            type: 'create',
            collection: 'charges',
            entityId: step.payload.id,
            data: step.payload,
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        case 'updateCharge':
          operations.push({
            id: step.opId,
            type: 'update',
            collection: 'charges',
            entityId: step.payload.chargeId,
            data: step.payload.updates,
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        case 'deleteCharge':
          operations.push({
            id: step.opId,
            type: 'delete',
            collection: 'charges',
            entityId: step.payload.chargeId,
            data: {},
            metadata: {
              source: 'local',
              timestamp: bundle.timestamp,
              vectorClock: bundle.vectorClock,
              deviceId: this.deviceId,
              version: 1
            }
          });
          break;
        default:
          console.error(`❌ Unknown bundle step kind: ${step.kind}`);
          throw new Error(`Unsupported bundle step kind: ${step.kind}`);
      }
    }
    
    return operations;
  }

  /**
   * Provisional state management (simplified for now)
   */
  private async addProvisionalAssignment(id: string, step: any): Promise<void> {
    const provisionalKey = 'provisional_assignments';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const data = dataStr ? JSON.parse(dataStr) : {};
    data[id] = step;
    await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
  }

  private async addProvisionalStockDelta(productId: string, delta: number, opId: string): Promise<void> {
    const provisionalKey = 'provisional_stock_deltas';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const data = dataStr ? JSON.parse(dataStr) : {};
    if (!data[productId]) data[productId] = [];
    
    // 🔒 IDEMPOTENCY CHECK: Prevent duplicate operations
    const existingOp = data[productId].find((op: any) => op.opId === opId);
    if (existingOp) {
      console.warn(`🚨 Preventing duplicate stock delta for product ${productId}, opId: ${opId}`);
      return; // Skip adding duplicate operation
    }
    
    data[productId].push({ delta, opId, timestamp: Date.now() });
    await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
  }

  private async addProvisionalBalanceDelta(playerId: string, delta: number, opId: string, bundleType?: string): Promise<void> {
    const provisionalKey = 'provisional_balance_deltas';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const data = dataStr ? JSON.parse(dataStr) : {};
    if (!data[playerId]) data[playerId] = [];
    
    // 🔒 IDEMPOTENCY CHECK: Prevent duplicate operations
    const existingOp = data[playerId].find((op: any) => op.opId === opId);
    if (existingOp) {
      console.warn(`🚨 Preventing duplicate balance delta for player ${playerId}, opId: ${opId}`);
      return; // Skip adding duplicate operation
    }
    
    data[playerId].push({ delta, opId, timestamp: Date.now(), bundleType });
    await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
  }

  private async addProvisionalAssignmentUpdate(assignmentId: string, updates: any, opId: string): Promise<void> {
    const provisionalKey = 'provisional_assignment_updates';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const data = dataStr ? JSON.parse(dataStr) : {};
    if (!data[assignmentId]) data[assignmentId] = [];
    data[assignmentId].push({ updates, opId, timestamp: Date.now() });
    await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
    console.log('💰 Added provisional assignment update:', { 
      assignmentId, 
      updates, 
      opId,
      totalUpdatesForAssignment: data[assignmentId].length
    });
  }

  private async addProvisionalOrganizationUpdate(organizationData: any, opId: string): Promise<void> {
    const provisionalKey = 'provisional_organization_updates';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const data = dataStr ? JSON.parse(dataStr) : [];
    data.push({ organization: organizationData, opId, timestamp: Date.now() });
    await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
    console.log('🏢 Added provisional organization update:', { 
      organizationData, 
      opId,
      totalUpdates: data.length
    });
  }

  private async addProvisionalCharge(id: string, step: any): Promise<void> {
    const provisionalKey = 'provisional_charges';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const data = dataStr ? JSON.parse(dataStr) : {};
    data[id] = step;
    await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
    console.log('💰 Added provisional charge:', { 
      chargeId: id, 
      amount: step.payload.amount,
      reason: step.payload.reason
    });
  }

  private async updateProvisionalCharge(chargeId: string, updates: any): Promise<void> {
    const provisionalKey = 'provisional_charges';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const data = dataStr ? JSON.parse(dataStr) : {};
    if (data[chargeId]) {
      // Update the charge payload with new values
      data[chargeId].payload = { ...data[chargeId].payload, ...updates };
      await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
      console.log('🔄 Updated provisional charge:', { chargeId, updates });
    }
  }

  private async removeProvisionalCharge(chargeId: string): Promise<void> {
    const provisionalKey = 'provisional_charges';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const data = dataStr ? JSON.parse(dataStr) : {};
    if (data[chargeId]) {
      delete data[chargeId];
      await AsyncStorage.setItem(provisionalKey, JSON.stringify(data));
      console.log('🗑️ Removed provisional charge:', { chargeId });
    }
  }

  private async persistProvisionalState(): Promise<void> {
    // Already persisted in individual methods above
    console.log('📝 Provisional state persisted');
  }

  // ============================================
  // ENHANCED PROVISIONAL OVERLAY SYSTEM (MD spec)
  // ============================================

  /**
   * Get products with provisional overlays (read reconciliation)
   */
  public async getProductsWithOverlay(): Promise<any[]> {
    const baseProducts = await this.getLocalData('products');
    const provisionalDeltas = await this.getProvisionalStockDeltas();
    
    return this.foldProductOverlay(baseProducts, provisionalDeltas);
  }

  /**
   * Get players with provisional overlays (read reconciliation)
   */
  public async getPlayersWithOverlay(): Promise<any[]> {
    const basePlayers = await this.getLocalData('players');
    const provisionalDeltas = await this.getProvisionalBalanceDeltas();
    
    return this.foldPlayerOverlay(basePlayers, provisionalDeltas);
  }

  /**
   * Get assignments with provisional overlays (read reconciliation)
   */
  public async getAssignmentsWithOverlay(): Promise<any[]> {
    const baseAssignments = await this.getLocalData('assignments');
    const provisionalAssignments = await this.getProvisionalAssignments();
    
    return await this.foldAssignmentOverlay(baseAssignments, provisionalAssignments);
  }

  /**
   * Get organization with provisional overlays (read reconciliation)
   */
  public async getOrganizationWithOverlay(): Promise<any | null> {
    // First get the base organization from AsyncStorage (as used by OrganizationContext)
    const organizationStr = await AsyncStorage.getItem('@organization_data');
    let baseOrganization = organizationStr ? JSON.parse(organizationStr) : null;
    
    // Get provisional updates
    const provisionalUpdates = await this.getProvisionalOrganizationUpdates();
    
    // Apply all provisional updates in chronological order
    if (provisionalUpdates.length > 0) {
      let updatedOrganization = { ...baseOrganization };
      for (const update of provisionalUpdates) {
        updatedOrganization = { ...updatedOrganization, ...update.organization };
        updatedOrganization._provisional = true; // Mark as having provisional data
      }
      console.log('🏢 Organization with overlay applied:', { 
        baseOrganization, 
        provisionalUpdates: provisionalUpdates.length,
        finalOrganization: updatedOrganization 
      });
      return updatedOrganization;
    }
    
    return baseOrganization;
  }

  /**
   * Get charges with provisional overlays (read reconciliation)
   */
  public async getChargesWithOverlay(): Promise<any[]> {
    const baseCharges = await this.getLocalData('charges');
    const provisionalCharges = await this.getProvisionalCharges();
    
    return await this.foldChargeOverlay(baseCharges, provisionalCharges);
  }

  /**
   * Fold product overlays (base + deltas)
   */
  private foldProductOverlay(base: any[], deltas: Record<string, any[]>): any[] {
    const byId = new Map(base.map(p => [p.id, { ...p }]));
    
    for (const [productId, deltaArray] of Object.entries(deltas)) {
      const product = byId.get(productId);
      if (product) {
        const totalDelta = deltaArray.reduce((sum, d) => sum + d.delta, 0);
        product.stock = (product.stock || 0) + totalDelta;
        product._provisional = true; // Mark as having provisional data
      }
    }
    
    return [...byId.values()];
  }

  /**
   * Fold player overlays (base + deltas)
   */
  private foldPlayerOverlay(base: any[], deltas: Record<string, any[]>): any[] {
    const byId = new Map(base.map(p => [p.id, { ...p }]));
    
    for (const [playerId, deltaArray] of Object.entries(deltas)) {
      const player = byId.get(playerId);
      if (player) {
        const totalDelta = deltaArray.reduce((sum, d) => sum + d.delta, 0);
        
        // Only count purchase bundles in statistics, not charges
        const purchaseDeltas = deltaArray.filter(d => d.bundleType === 'purchase' && d.delta > 0);
        const purchaseCount = purchaseDeltas.length;
        const totalSpentDelta = purchaseDeltas.reduce((sum, d) => sum + d.delta, 0);
        
        player.balance = (player.balance || 0) + totalDelta;
        player.totalSpent = (player.totalSpent || 0) + totalSpentDelta;
        player.totalPurchases = (player.totalPurchases || 0) + purchaseCount;
        player._provisional = true; // Mark as having provisional data
        
        console.log('📊 Applied provisional player statistics:', {
          playerId,
          balanceDelta: totalDelta,
          totalSpentDelta,
          purchaseCountDelta: purchaseCount,
          newBalance: player.balance,
          newTotalSpent: player.totalSpent,
          newTotalPurchases: player.totalPurchases,
          deltaTypes: deltaArray.map(d => ({ delta: d.delta, bundleType: d.bundleType }))
        });
      }
    }
    
    return [...byId.values()];
  }

  /**
   * Fold assignment overlays (base + provisional)
   */  
  private async foldAssignmentOverlay(base: any[], provisional: Record<string, any>): Promise<any[]> {
    const result = [...base];
    
    // 1. Add new provisional assignments
    for (const [assignmentId, provAssignment] of Object.entries(provisional)) {
      // Check if this assignment is already in base (shouldn't be for new ones)
      const existsInBase = base.find(a => a.id === assignmentId);
      if (!existsInBase) {
        result.push({
          ...provAssignment.payload,
          _provisional: true
        });
      }
    }
    
    // 2. Apply provisional assignment updates (like payment status)
    const provisionalUpdates = await this.getProvisionalAssignmentUpdates();
    let updatesApplied = 0;
    for (const assignment of result) {
      if (provisionalUpdates[assignment.id]) {
        const updates = provisionalUpdates[assignment.id];
        console.log('💰 Applying provisional updates to assignment:', {
          assignmentId: assignment.id,
          updateCount: updates.length,
          updates: updates.map((u: any) => u.updates)
        });
        // Apply all updates in order
        updates.forEach((update: any) => {
          Object.assign(assignment, update.updates);
          assignment._provisional = true; // Mark as having provisional changes
          updatesApplied++;
        });
      }
    }
    console.log('💰 Total provisional assignment updates applied:', updatesApplied);
    
    return result;
    
    return result;
  }

  /**
   * Fold charge overlays (base + provisional)
   */  
  private async foldChargeOverlay(base: any[], provisional: Record<string, any>): Promise<any[]> {
    const result = [...base];
    
    // Add new provisional charges
    for (const [chargeId, provCharge] of Object.entries(provisional)) {
      // Check if this charge is already in base (shouldn't be for new ones)
      const existsInBase = base.find(c => c.id === chargeId);
      if (!existsInBase) {
        result.push({
          ...provCharge.payload,
          _provisional: true
        });
      }
    }
    
    return result;
  }

  /**
   * Get provisional stock deltas
   */
  private async getProvisionalStockDeltas(): Promise<Record<string, any[]>> {
    const provisionalKey = 'provisional_stock_deltas';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    return dataStr ? JSON.parse(dataStr) : {};
  }

  /**
   * Get provisional balance deltas
   */
  private async getProvisionalBalanceDeltas(): Promise<Record<string, any[]>> {
    const provisionalKey = 'provisional_balance_deltas';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    return dataStr ? JSON.parse(dataStr) : {};
  }

  /**
   * Get provisional assignments
   */
  private async getProvisionalAssignments(): Promise<Record<string, any>> {
    const provisionalKey = 'provisional_assignments';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    return dataStr ? JSON.parse(dataStr) : {};
  }

  /**
   * Get provisional charges
   */
  private async getProvisionalCharges(): Promise<Record<string, any>> {
    const provisionalKey = 'provisional_charges';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    return dataStr ? JSON.parse(dataStr) : {};
  }

  private async getProvisionalAssignmentUpdates(): Promise<Record<string, any[]>> {
    const provisionalKey = 'provisional_assignment_updates';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const result = dataStr ? JSON.parse(dataStr) : {};
    console.log('📋 Provisional assignment updates loaded:', Object.keys(result).length, 'assignments with updates');
    return result;
  }

  private async getProvisionalOrganizationUpdates(): Promise<any[]> {
    const provisionalKey = 'provisional_organization_updates';
    const dataStr = await AsyncStorage.getItem(provisionalKey);
    const result = dataStr ? JSON.parse(dataStr) : [];
    console.log('🏢 Provisional organization updates loaded:', result.length, 'updates');
    return result;
  }

  // DEBUG METHOD: Call this to inspect provisional data
  public async debugProvisionalData(): Promise<void> {
    console.log('🔍 DEBUG: Provisional Data State');
    
    const assignmentUpdates = await this.getProvisionalAssignmentUpdates();
    const balanceDeltas = await this.getProvisionalBalanceDeltas();
    const assignments = await this.getProvisionalAssignments();
    const organizationUpdates = await this.getProvisionalOrganizationUpdates();
    
    console.log('🔍 Provisional Assignment Updates:');
    Object.entries(assignmentUpdates).forEach(([assignmentId, updates]) => {
      console.log(`  - Assignment ${assignmentId}:`, updates);
    });
    
    console.log('🔍 Provisional Balance Deltas:');
    Object.entries(balanceDeltas).forEach(([playerId, deltas]) => {
      console.log(`  - Player ${playerId}:`, deltas);
    });
    
    console.log('🔍 Provisional Assignments:', Object.keys(assignments).length);
    
    console.log('🔍 Provisional Organization Updates:', organizationUpdates.length);
    organizationUpdates.forEach((update, index) => {
      console.log(`  - Update ${index}:`, update);
    });
    
    const bundlesCount = await this.getPendingBundlesCount();
    console.log('🔍 Pending Bundles:', bundlesCount);
  }

  /**
   * Clear provisional data for committed operations (cleanup)
   */
  public async clearProvisionalData(opIds: string[]): Promise<void> {
    console.log('🧹 Clearing provisional data for committed ops:', opIds);
    
    // This would remove provisional entries that match the given opIds
    // Simplified implementation for now
    try {
      const stockDeltas = await this.getProvisionalStockDeltas();
      const balanceDeltas = await this.getProvisionalBalanceDeltas();
      const assignments = await this.getProvisionalAssignments();
      const assignmentUpdates = await this.getProvisionalAssignmentUpdates();
      
      // Filter out committed operations
      for (const [key, deltas] of Object.entries(stockDeltas)) {
        stockDeltas[key] = deltas.filter((d: any) => !opIds.includes(d.opId));
        if (stockDeltas[key].length === 0) delete stockDeltas[key];
      }
      
      for (const [key, deltas] of Object.entries(balanceDeltas)) {
        balanceDeltas[key] = deltas.filter((d: any) => !opIds.includes(d.opId));
        if (balanceDeltas[key].length === 0) delete balanceDeltas[key];
      }

      // Filter out committed assignment updates
      for (const [key, updates] of Object.entries(assignmentUpdates)) {
        assignmentUpdates[key] = updates.filter((u: any) => !opIds.includes(u.opId));
        if (assignmentUpdates[key].length === 0) delete assignmentUpdates[key];
      }
      
      // Remove committed assignments
      for (const opId of opIds) {
        for (const [key, assignment] of Object.entries(assignments)) {
          if ((assignment as any).opId === opId) {
            delete assignments[key];
          }
        }
      }
      
      // Persist cleaned data
      await AsyncStorage.setItem('provisional_stock_deltas', JSON.stringify(stockDeltas));
      await AsyncStorage.setItem('provisional_balance_deltas', JSON.stringify(balanceDeltas));
      await AsyncStorage.setItem('provisional_assignments', JSON.stringify(assignments));
      await AsyncStorage.setItem('provisional_assignment_updates', JSON.stringify(assignmentUpdates));
      
      console.log('✅ Provisional data cleanup completed');
      
    } catch (error) {
      console.error('❌ Provisional data cleanup failed:', error);
    }
  }

  private async enqueueBundleForSync(bundle: any): Promise<void> {
    // According to MD spec: Bundles should be queued as atomic units for offline-first support
    console.log('📦 Enqueueing bundle for atomic sync:', bundle.bundleId);
    
    try {
      // Store bundle in pending bundles queue for offline support
      const pendingBundles = await this.getPendingBundles();
      pendingBundles.push(bundle);
      await AsyncStorage.setItem('pending_bundles', JSON.stringify(pendingBundles));
      
      console.log('✅ Bundle queued for sync:', bundle.bundleId);
      console.log('📊 Pending bundles queue size:', pendingBundles.length);
      
    } catch (error) {
      console.error('❌ Failed to enqueue bundle:', error);
      throw error;
    }
  }

  private async getPendingBundles(): Promise<any[]> {
    try {
      const stored = await AsyncStorage.getItem('pending_bundles');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('❌ Failed to get pending bundles:', error);
      return [];
    }
  }

  public async getPendingBundlesCount(): Promise<number> {
    const bundles = await this.getPendingBundles();
    return bundles.length;
  }

  public async getPendingOperationsCount(): Promise<number> {
    return this.syncQueue.length;
  }

  /**
   * Get detailed information about unsynced data for logout safety warnings
   */
  public async getUnsyncedDataDetails(): Promise<{
    totalCount: number;
    operationsByType: Record<string, number>;
    operationsByCollection: Record<string, number>;
    hasUnsyncedData: boolean;
    oldestOperation?: { timestamp: number; age: string; type: string; collection: string };
  }> {
    const operationsByType: Record<string, number> = {};
    const operationsByCollection: Record<string, number> = {};
    let oldestOperation: { timestamp: number; age: string; type: string; collection: string } | undefined;

    // Analyze sync queue operations
    for (const operation of this.syncQueue) {
      // Count by operation type (SyncQueueItem uses 'action' field)
      const opType = operation.action || 'unknown';
      operationsByType[opType] = (operationsByType[opType] || 0) + 1;

      // Count by collection
      const collection = operation.collection || 'unknown';
      operationsByCollection[collection] = (operationsByCollection[collection] || 0) + 1;

      // Track oldest operation (SyncQueueItem has direct timestamp field)
      const opTimestamp = operation.timestamp || Date.now();
      if (!oldestOperation || opTimestamp < oldestOperation.timestamp) {
        const ageMs = Date.now() - opTimestamp;
        const ageMinutes = Math.floor(ageMs / (1000 * 60));
        const ageHours = Math.floor(ageMinutes / 60);
        const ageString = ageHours > 0 
          ? `${ageHours}h ${ageMinutes % 60}m ago`
          : `${ageMinutes}m ago`;

        oldestOperation = {
          timestamp: opTimestamp,
          age: ageString,
          type: opType,
          collection
        };
      }
    }

    return {
      totalCount: this.syncQueue.length,
      operationsByType,
      operationsByCollection,
      hasUnsyncedData: this.syncQueue.length > 0,
      oldestOperation
    };
  }

  /**
   * Check if it's safe to logout (no pending operations)
   */
  public async isSafeToLogout(): Promise<boolean> {
    const pendingOps = await this.getPendingOperationsCount();
    const pendingBundles = await this.getPendingBundlesCount();
    return pendingOps === 0 && pendingBundles === 0;
  }

  /**
   * Get current online status
   */
  public getOnlineStatus(): boolean {
    return this.isOnline;
  }

  private async processPendingBundles(bundles: any[]): Promise<void> {
    for (const bundle of bundles) {
      try {
        console.log('📦 Processing pending bundle:', bundle.bundleId);
        await this.processSingleBundle(bundle);
        console.log('✅ Pending bundle processed:', bundle.bundleId);
      } catch (error) {
        console.error('❌ Failed to process pending bundle:', bundle.bundleId, error);
        // Leave bundle in queue for retry
        throw error;
      }
    }

    // Clear processed bundles
    await AsyncStorage.setItem('pending_bundles', JSON.stringify([]));
    console.log('✅ All pending bundles processed and cleared');
  }

  private async getBumpedVectorClock(): Promise<Record<string, number>> {
    // Simplified vector clock - just return current timestamp
    return { [this.deviceId]: Date.now() };
  }

  /**
   * Apply operation to local cache with conflict resolution
   */
  private async applyOpToLocalCache(operation: Operation): Promise<void> {
    const { collection, type, entityId, data, metadata } = operation;
    
    // Validate and normalize timestamp to ISO string for storage
    let normalizedTimestamp: string;
    try {
      if (typeof metadata.timestamp === 'string') {
        // If it's already an ISO string, use it directly
        normalizedTimestamp = metadata.timestamp;
        // Validate it's a valid date
        const testDate = new Date(normalizedTimestamp);
        if (isNaN(testDate.getTime())) {
          throw new Error(`Invalid date string: ${normalizedTimestamp}`);
        }
      } else if (typeof metadata.timestamp === 'number') {
        // If it's a number (milliseconds), convert to ISO string
        const date = new Date(metadata.timestamp);
        if (isNaN(date.getTime())) {
          throw new Error(`Invalid timestamp number: ${metadata.timestamp}`);
        }
        normalizedTimestamp = date.toISOString();
      } else {
        throw new Error(`Invalid timestamp type: ${typeof metadata.timestamp}`);
      }
    } catch (error) {
      console.error('❌ Invalid timestamp in operation:', metadata.timestamp, error);
      // Fallback to current timestamp
      normalizedTimestamp = new Date().toISOString();
      console.warn('⚠️ Using current timestamp as fallback:', normalizedTimestamp);
    }

    console.log('💾 Applying to local cache:', {
      collection,
      type,
      entityId,
      timestamp: normalizedTimestamp,
      originalTimestamp: metadata.timestamp
    });

    // Get current local data
    const currentData = await this.getLocalData(collection);
    let updatedData: any[];

    switch (type) {
      case 'create':
        updatedData = await this.applyCreateOp(currentData, data, metadata, normalizedTimestamp);
        break;
        
      case 'update':
        updatedData = await this.applyUpdateOp(currentData, entityId!, data, metadata, normalizedTimestamp);
        break;
        
      case 'updateBalance':
        // IMPORTANT: Balance updates should only be processed by sync queue to avoid duplication
        // Local balance updates happen through provisional overlays for immediate UI feedback
        console.log('💰 updateBalance operation - skipping local update, will be handled by sync queue');
        updatedData = currentData; // Don't modify local data, only sync queue should handle this
        break;
        
      case 'createAssignmentTransaction':
        // This is a compound operation that affects multiple collections
        await this.applyAssignmentTransactionOp(data, metadata, normalizedTimestamp);
        return; // Early return since we handle multiple collections internally
        
      case 'delete':
        updatedData = await this.applyDeleteOp(currentData, entityId!, metadata);
        break;
        
      default:
        throw new Error(`Unknown operation type: ${type}`);
    }

    // Atomically save updated data
    await this.saveLocalData(collection, updatedData);
    
    console.log('✅ Local cache updated successfully');
  }

  /**
   * Apply create operation to local data
   */
  private async applyCreateOp(currentData: any[], entityData: any, metadata: Operation['metadata'], normalizedTimestamp: string): Promise<any[]> {
    // Use the already normalized timestamp
    
    const newEntity = {
      ...entityData,
      id: entityData.id || generateUUID(),
      createdAt: normalizedTimestamp,
      updatedAt: normalizedTimestamp,
      version: this.createVersionVector()
    };
    
    // Check if entity already exists (idempotency)
    const existingIndex = currentData.findIndex(item => item.id === newEntity.id);
    if (existingIndex !== -1) {
      console.log('⏭️ Create operation idempotent - entity already exists:', newEntity.id);
      return currentData; // No change needed
    }
    
    return [...currentData, newEntity];
  }

  /**
   * Apply update operation with conflict resolution
   */
  private async applyUpdateOp(currentData: any[], entityId: string, updates: any, metadata: Operation['metadata'], normalizedTimestamp: string): Promise<any[]> {
    const entityIndex = currentData.findIndex(item => item.id === entityId);
    
    if (entityIndex === -1) {
      console.warn('⚠️ Update operation - entity not found:', entityId);
      return currentData; // No change if entity doesn't exist
    }
    
    const currentEntity = currentData[entityIndex];
    const updatedData = [...currentData];
    
    // Apply conflict resolution rules
    const resolvedEntity = await this.resolveConflicts(currentEntity, updates, metadata);
    
    updatedData[entityIndex] = {
      ...resolvedEntity,
      updatedAt: normalizedTimestamp,
      version: this.createVersionVector()
    };
    
    console.log('🔄 Entity updated with conflict resolution:', entityId);
    return updatedData;
  }

  /**
   * Apply balance update operation (specialized for player balances)
   */
  private async applyBalanceUpdateOp(currentData: any[], playerId: string, balanceData: any, metadata: Operation['metadata'], normalizedTimestamp: string): Promise<any[]> {
    const playerIndex = currentData.findIndex(item => item.id === playerId);
    
    if (playerIndex === -1) {
      console.warn('⚠️ Balance update - player not found:', playerId);
      return currentData;
    }
    
    const player = { ...currentData[playerIndex] };
    const { amount, isDebit } = balanceData;
    
    // Apply balance changes with conflict resolution
    const currentBalance = player.balance || 0;
    const newBalance = isDebit ? 
      currentBalance + amount : 
      Math.max(0, currentBalance - amount);
    
    // Update tracking fields
    player.balance = newBalance;
    if (isDebit) {
      player.totalSpent = (player.totalSpent || 0) + amount;
      player.totalPurchases = (player.totalPurchases || 0) + 1;
    }
    
    // Set metadata with normalized timestamp
    player.updatedAt = normalizedTimestamp;
    player.version = this.createVersionVector();
    
    const updatedData = [...currentData];
    updatedData[playerIndex] = player;
    
    console.log('💰 Balance updated via applyOp:', {
      playerId,
      newBalance,
      amount,
      isDebit
    });
    
    return updatedData;
  }

  /**
   * Apply delete operation
   */
  private async applyDeleteOp(currentData: any[], entityId: string, metadata: Operation['metadata']): Promise<any[]> {
    const filteredData = currentData.filter(item => item.id !== entityId);
    
    if (filteredData.length === currentData.length) {
      console.log('⏭️ Delete operation idempotent - entity already removed:', entityId);
    } else {
      console.log('🗑️ Entity deleted via applyOp:', entityId);
    }
    
    return filteredData;
  }

  /**
   * Apply compound assignment transaction - affects multiple collections atomically
   */
  private async applyAssignmentTransactionOp(data: any, metadata: Operation['metadata'], normalizedTimestamp: string): Promise<void> {
    console.log('💰 Applying assignment transaction to local cache:', {
      assignment: data.id,
      product: data.productId,
      player: data.playerId,
      quantity: data.quantity,
      total: data.total
    });

    try {
      // 1. Create the assignment
      const assignmentsData = await this.getLocalData('assignments');
      const newAssignment = {
        ...data,
        createdAt: normalizedTimestamp,
        updatedAt: normalizedTimestamp,
        version: this.createVersionVector()
      };

      // Check if assignment already exists (idempotency)
      const existingAssignmentIndex = assignmentsData.findIndex(item => item.id === newAssignment.id);
      if (existingAssignmentIndex !== -1) {
        console.log('⏭️ Assignment transaction idempotent - assignment already exists:', newAssignment.id);
        return; // Early return - transaction already applied
      }

      const updatedAssignments = [...assignmentsData, newAssignment];

      // 2. Reduce product stock
      const productsData = await this.getLocalData('products');
      const productIndex = productsData.findIndex(p => p.id === data.productId);
      if (productIndex === -1) {
        throw new Error(`Product not found for assignment transaction: ${data.productId}`);
      }

      const product = productsData[productIndex];
      if (product.stock < data.quantity) {
        throw new Error(`Insufficient stock for product ${product.name}. Available: ${product.stock}, Required: ${data.quantity}`);
      }

      const updatedProducts = [...productsData];
      updatedProducts[productIndex] = {
        ...product,
        stock: product.stock - data.quantity,
        updatedAt: normalizedTimestamp,
        version: this.createVersionVector()
      };

      // 3. Update player balance and stats
      const playersData = await this.getLocalData('players');
      const playerIndex = playersData.findIndex(p => p.id === data.playerId);
      if (playerIndex === -1) {
        throw new Error(`Player not found for assignment transaction: ${data.playerId}`);
      }

      const player = playersData[playerIndex];
      const updatedPlayers = [...playersData];
      updatedPlayers[playerIndex] = {
        ...player,
        // REMOVED: balance update - this is now handled by bundle balanceDelta operations
        // balance: (player.balance || 0) + data.total, // DUPLICATE - causes double charging
        totalSpent: (player.totalSpent || 0) + data.total,
        totalPurchases: (player.totalPurchases || 0) + data.quantity,
        updatedAt: normalizedTimestamp,
        version: this.createVersionVector()
      };

      // 4. Save all updates atomically
      await Promise.all([
        this.saveLocalData('assignments', updatedAssignments),
        this.saveLocalData('products', updatedProducts),
        this.saveLocalData('players', updatedPlayers)
      ]);

      console.log('✅ Assignment transaction applied to local cache:', {
        assignmentId: newAssignment.id,
        productStockReduced: data.quantity,
        newStock: updatedProducts[productIndex].stock,
        playerBalanceIncreased: data.total,
        newBalance: updatedPlayers[playerIndex].balance
      });

    } catch (error) {
      console.error('❌ Failed to apply assignment transaction:', error);
      throw error;
    }
  }

  // ============================================
  // APPLYOP HELPER FUNCTIONS
  // ============================================

  /**
   * Get local data for a collection (always read local first)
   */
  private async getLocalData(collection: string): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem(collection);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error(`❌ Error reading local ${collection}:`, error);
      return [];
    }
  }

  /**
   * Save data to local cache atomically
   */
  private async saveLocalData(collection: string, data: any[]): Promise<void> {
    try {
      await AsyncStorage.setItem(collection, JSON.stringify(data));
      console.log(`💾 Saved ${data.length} items to local ${collection}`);
    } catch (error) {
      console.error(`❌ Error saving local ${collection}:`, error);
      throw error;
    }
  }

  /**
   * Add operation to outbox for server sync
   */
  private async addOpToOutbox(operation: Operation): Promise<void> {
    console.log('📤 OUTBOX DEBUG - Adding operation to outbox:', {
      operationId: operation.id,
      type: operation.type,
      collection: operation.collection,
      entityId: operation.entityId,
      currentQueueSize: this.syncQueue.length
    });
    
    // Use the centralized method that checks for duplicates
    this.addToSyncQueue({
      id: operation.id,
      action: operation.type as any,
      collection: operation.collection,
      data: {
        ...operation.data,
        entityId: operation.entityId,
        metadata: operation.metadata
      },
      // Extract batch info from operation data if present
      batchId: operation.data?.batchId,
      batchLabel: operation.data?.batchLabel
    });
    
    console.log('📤 Operation added to outbox:', operation.id);
    
    // Special logging for player operations
    if (operation.collection === 'players' && operation.type === 'create') {
      console.log('🎯 OUTBOX - Player creation queued:', {
        operationId: operation.id,
        playerId: operation.entityId,
        playerName: operation.data?.name || `${operation.data?.firstName} ${operation.data?.lastName}`,
        queueLength: this.syncQueue.length,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Remove operation from outbox after successful sync
   */
  private async removeOpFromOutbox(operationId: string): Promise<void> {
    const initialLength = this.syncQueue.length;
    this.syncQueue = this.syncQueue.filter(item => item.id !== operationId);
    const removedCount = initialLength - this.syncQueue.length;
    
    if (removedCount > 0) {
      await this.saveSyncQueue();
      console.log('🗑️ Removed operation from outbox:', operationId, `(${removedCount} items removed)`);
    }
  }

  /**
   * Attempt to sync operation to server immediately
   */
  private async syncOpToServer(operation: Operation): Promise<void> {
    // Use the global firebaseService instance that has the organization ID set
    if (!firebaseService.isReady()) {
      throw new Error('FirebaseService is not ready. Organization ID not set.');
    }
    
    console.log('🔥 SYNC TO SERVER - Starting:', {
      collection: operation.collection,
      type: operation.type,
      entityId: operation.entityId,
      operationId: operation.id,
      hasData: !!operation.data,
      timestamp: new Date().toISOString()
    });
    
    switch (operation.collection) {
      case 'players':
        if (operation.type === 'updateBalance') {
          const { entityId, data } = operation;
          console.log('🔥 PLAYER BALANCE UPDATE - Will be handled by sync queue:', { entityId, amount: data.amount, isDebit: data.isDebit });
          // REMOVED: Direct Firebase call causes duplicate balance updates
          // Balance updates are handled by the sync queue to avoid duplication
          console.log('✅ Player balance update queued for sync processing');
        } else if (operation.type === 'update') {
          console.log('🔥 PLAYER UPDATE - Using logical UUID directly:', { 
            entityUUID: operation.entityId, 
            data: operation.data 
          });
          
          // FIXED: FirebaseService.updatePlayer handles logical UUID mapping internally
          const playerUUID = operation.entityId!;
          await firebaseService.updatePlayer(playerUUID, operation.data);
          console.log('✅ Player update completed with logical UUID');
        } else if (operation.type === 'delete') {
          console.log('🗑️ SYNC TO SERVER - Deleting player:', operation.entityId);
          await firebaseService.deletePlayer(operation.entityId!);
          console.log('✅ Player deleted from Firebase:', operation.entityId);
        } else if (operation.type === 'create') {
          console.log('🔥 PLAYER CREATE - Raw operation data:', { 
            originalData: operation.data,
            operationId: operation.id,
            entityId: operation.entityId
          });
          // CRITICAL FIX: Preserve UUID id field, only remove Firebase-generated fields
          const { createdAt, updatedAt, ...playerDataForFirebase } = operation.data;
          console.log('🔥 PLAYER CREATE - Data for Firebase (preserving UUID id):', { 
            cleanedData: playerDataForFirebase,
            preservedId: playerDataForFirebase.id,
            removedFields: { createdAt, updatedAt }
          });
          
          try {
            const result = await firebaseService.addPlayer(playerDataForFirebase);
            console.log('✅ Player created in Firebase:', { result, originalId: operation.entityId });
          } catch (error) {
            console.error('❌ Firebase player creation failed:', { 
              error: error instanceof Error ? error.message : String(error), 
              data: playerDataForFirebase,
              operationId: operation.id 
            });
            throw error;
          }
        }
        break;
        
      case 'assignments':
        if (operation.type === 'update') {
          await firebaseService.updateAssignment(operation.entityId!, operation.data);
        } else if (operation.type === 'create') {
          // Clean assignment data before sending to Firebase (remove operation metadata)
          const { 
            entityId, 
            metadata, 
            vectorClock, 
            version, 
            deviceId, 
            timestamp,
            createdAt, 
            updatedAt, 
            ...cleanAssignmentData 
          } = operation.data;
          
          console.log('🔄 Cleaned assignment data for Firebase:', {
            original: operation.data,
            cleaned: cleanAssignmentData,
            removedFields: { entityId, metadata, vectorClock, version, deviceId, timestamp, createdAt, updatedAt }
          });
          
          await firebaseService.addAssignment(cleanAssignmentData);
        } else if (operation.type === 'delete') {
          console.log('🗑️ SYNC TO SERVER - Deleting assignment:', operation.entityId);
          await firebaseService.deleteAssignment(operation.entityId!);
          console.log('✅ Assignment deleted from Firebase:', operation.entityId);
        }
        break;
        
      case 'products':
        if (operation.type === 'update') {
          console.log('🔄 SYNC TO SERVER - Product update operation:', {
            entityId: operation.entityId,
            data: operation.data,
            operationId: operation.id,
            dataKeys: Object.keys(operation.data || {}),
            hasStockUpdate: operation.data?.stock !== undefined
          });
          
          try {
            await firebaseService.updateProduct(operation.entityId!, operation.data);
            console.log('✅ SYNC TO SERVER - Product update successful:', {
              productId: operation.entityId,
              updatedFields: Object.keys(operation.data || {}),
              operationId: operation.id
            });
          } catch (error) {
            console.error('❌ SYNC TO SERVER - Product update failed:', {
              productId: operation.entityId,
              error: error instanceof Error ? error.message : String(error),
              operationId: operation.id,
              data: operation.data
            });
            throw error;
          }
        } else if (operation.type === 'delete') {
          console.log('🗑️ SYNC TO SERVER - Deleting product:', operation.entityId);
          await firebaseService.deleteProduct(operation.entityId!);
          console.log('✅ Product deleted from Firebase:', operation.entityId);
        } else if (operation.type === 'create') {
          // Clean product data before sending to Firebase (remove operation metadata)
          const { 
            entityId, 
            metadata, 
            vectorClock, 
            version, 
            deviceId, 
            timestamp,
            createdAt, 
            updatedAt, 
            ...cleanProductData 
          } = operation.data;
          
          console.log('🔄 Cleaned product data for Firebase:', {
            original: operation.data,
            cleaned: cleanProductData,
            removedFields: { entityId, metadata, vectorClock, version, deviceId, timestamp, createdAt, updatedAt }
          });
          
          await firebaseService.addProduct(cleanProductData);
        }
        break;
        
      case 'staff-users':
        if (operation.type === 'update') {
          console.log('🔄 SYNC TO SERVER - Staff user update operation:', {
            entityId: operation.entityId,
            data: operation.data,
            operationId: operation.id
          });
          
          try {
            await firebaseService.updateStaffUser(operation.entityId!, operation.data);
            console.log('✅ SYNC TO SERVER - Staff user update successful:', {
              staffUserId: operation.entityId,
              operationId: operation.id
            });
          } catch (error) {
            console.error('❌ SYNC TO SERVER - Staff user update failed:', {
              staffUserId: operation.entityId,
              error: error instanceof Error ? error.message : String(error),
              operationId: operation.id,
              data: operation.data
            });
            throw error;
          }
        } else if (operation.type === 'delete') {
          console.log('🗑️ SYNC TO SERVER - Deleting staff user:', operation.entityId);
          await firebaseService.deleteStaffUser(operation.entityId!);
          console.log('✅ Staff user deleted from Firebase:', operation.entityId);
        } else if (operation.type === 'create') {
          // Clean staff user data before sending to Firebase (remove operation metadata)
          const { 
            entityId, 
            metadata, 
            vectorClock, 
            version, 
            deviceId, 
            timestamp,
            createdAt, 
            updatedAt, 
            ...cleanStaffUserData 
          } = operation.data;
          
          console.log('🔄 Cleaned staff user data for Firebase:', {
            original: operation.data,
            cleaned: cleanStaffUserData,
            removedFields: { entityId, metadata, vectorClock, version, deviceId, timestamp, createdAt, updatedAt }
          });
          
          await firebaseService.addStaffUser(cleanStaffUserData);
          console.log('✅ Staff user created in Firebase:', operation.entityId);
        }
        break;
        
      default:
        console.warn('⚠️ Server sync not implemented for:', operation.collection);
    }

    // Handle compound operations that affect multiple collections
    if (operation.type === 'createAssignmentTransaction') {
      await this.syncAssignmentTransactionToServer(operation);
    }
    
    console.log('🔥 Operation synced to server:', operation.id);
  }

  /**
   * Sync compound assignment transaction to server  
   * FIXED: Proper dependency order and UPSERT logic
   */
  private async syncAssignmentTransactionToServer(operation: Operation): Promise<void> {
    // Use the global firebaseService instance that has the organization ID set
    if (!firebaseService.isReady()) {
      throw new Error('FirebaseService is not ready. Organization ID not set.');
    }
    
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

      console.log('� SYNC DEBUG - Entities found:', {
        product: { id: product.id, name: product.name, stock: product.stock },
        player: { id: player.id, name: `${player.firstName} ${player.lastName}`, balance: player.balance },
        assignment: { id: assignment.id, total: assignment.total }
      });

      // STEP 1: Ensure product exists in Firebase (UPSERT)
      const { createdAt: pCreatedAt, updatedAt: pUpdatedAt, version: pVersion, vectorClock: pVectorClock, ...cleanProduct } = product;
      console.log('📦 Upserting product to Firebase:', cleanProduct.id);
      await firebaseService.upsertProduct(cleanProduct);
      
      // STEP 2: Ensure player exists in Firebase (UPSERT) 
      const { createdAt: plCreatedAt, updatedAt: plUpdatedAt, version: plVersion, vectorClock: plVectorClock, ...cleanPlayer } = player;
      console.log('👤 Upserting player to Firebase:', cleanPlayer.id);
      await firebaseService.upsertPlayer(cleanPlayer);

      
      // STEP 3: Create/update assignment in Firebase (UPSERT)
      const { createdAt: aCreatedAt, updatedAt: aUpdatedAt, version: aVersion, vectorClock: aVectorClock, ...cleanAssignment } = assignment;
      console.log('📋 Upserting assignment to Firebase:', cleanAssignment.id);
      await firebaseService.upsertAssignment(cleanAssignment);
      
      console.log('✅ Assignment transaction synced to server successfully:', operation.entityId);

    } catch (error) {
      console.error('❌ Assignment transaction sync failed:', error);
      throw error;
    }
  }

  /**
   * Resolve conflicts using timestamp and vector clock rules
   */
  private async resolveConflicts(currentEntity: any, updates: any, metadata: Operation['metadata']): Promise<any> {
    // Safely convert current timestamp
    let currentUpdatedAt: number;
    try {
      currentUpdatedAt = new Date(currentEntity.updatedAt || 0).getTime();
      if (isNaN(currentUpdatedAt)) {
        currentUpdatedAt = 0;
      }
    } catch (error) {
      console.warn('⚠️ Invalid currentEntity.updatedAt:', currentEntity.updatedAt);
      currentUpdatedAt = 0;
    }
    
    // Safely convert update timestamp
    let updateTimestamp: number;
    try {
      if (typeof metadata.timestamp === 'string') {
        updateTimestamp = new Date(metadata.timestamp).getTime();
      } else {
        updateTimestamp = metadata.timestamp;
      }
      if (isNaN(updateTimestamp)) {
        throw new Error('Invalid timestamp conversion');
      }
    } catch (error) {
      console.warn('⚠️ Invalid metadata.timestamp:', metadata.timestamp, error);
      updateTimestamp = Date.now();
    }
    
    console.log('🔀 Resolving conflicts:', {
      entityId: currentEntity.id,
      currentTime: new Date(currentUpdatedAt).toISOString(),
      updateTime: new Date(updateTimestamp).toISOString(),
      source: metadata.source,
      timestampType: typeof metadata.timestamp
    });

    // ENHANCED: Check if we should use additive conflict resolution for numerical fields
    if (this.shouldUseAdditiveResolution(currentEntity, { ...currentEntity, ...updates }, metadata)) {
      console.log('🧮 Using additive conflict resolution for concurrent numerical changes');
      return this.resolveAdditiveConflicts(currentEntity, { ...currentEntity, ...updates }, metadata);
    }

    // FIXED: Server operations should still respect timestamps to preserve offline changes
    // Only accept server data if it's actually newer than local data
    if (metadata.source === 'server') {
      // Check if force server mode is enabled (bypass conflict resolution)
      if (this.forceServerMode) {
        console.log('💪 Force server mode enabled - accepting server state regardless of timestamp');
        return {
          ...currentEntity,
          ...updates
        };
      }
      
      if (updateTimestamp > currentUpdatedAt) {
        console.log('🔥 Server operation with newer timestamp - accepting server state');
        return {
          ...currentEntity,
          ...updates
        };
      } else {
        console.log('🛡️ Server operation with older timestamp - preserving local changes');
        return currentEntity;
      }
    }

    // For local operations, use timestamp comparison
    if (updateTimestamp > currentUpdatedAt) {
      console.log('🕐 Update is newer - accepting changes');
      return {
        ...currentEntity,
        ...updates
      };
    } else if (updateTimestamp === currentUpdatedAt) {
      // Same timestamp - use vector clock if available
      if (currentEntity.version && metadata.vectorClock) {
        const shouldAccept = this.vectorClockComparison(
          currentEntity.version.vectorClock,
          metadata.vectorClock
        );
        
        if (shouldAccept) {
          console.log('🕐 Vector clock comparison - accepting changes');
          return {
            ...currentEntity,
            ...updates
          };
        }
      }
    }
    
    console.log('⏸️ Update is older or concurrent - keeping current state');
    return currentEntity;
  }

  /**
   * Compare vector clocks for conflict resolution
   */
  private vectorClockComparison(current: Record<string, number>, incoming: Record<string, number>): boolean {
    // Simple comparison - in production you'd want more sophisticated logic
    const currentSum = Object.values(current).reduce((sum, val) => sum + val, 0);
    const incomingSum = Object.values(incoming).reduce((sum, val) => sum + val, 0);
    
    return incomingSum > currentSum;
  }

  /**
   * Determine if we should use additive resolution for numerical conflicts
   * This handles concurrent stock/balance changes by preserving operations
   */
  private shouldUseAdditiveResolution(currentEntity: any, updatedEntity: any, metadata: Operation['metadata']): boolean {
    // Only use additive resolution for concurrent operations (within sync window)
    if (!this.hasRecentConcurrentActivity(currentEntity, updatedEntity)) {
      return false;
    }

    // Check if this is a Product with stock differences
    if (currentEntity.currentStock !== undefined && updatedEntity.currentStock !== undefined) {
      const stockDifference = Math.abs(currentEntity.currentStock - updatedEntity.currentStock);
      return stockDifference > 0;
    }
    
    // Check if this is a Player with balance differences  
    if (currentEntity.balance !== undefined && updatedEntity.balance !== undefined) {
      const balanceDifference = Math.abs(currentEntity.balance - updatedEntity.balance);
      return balanceDifference > 0;
    }
    
    return false;
  }

  /**
   * Check if both entities have been updated recently (within sync window)
   */
  private hasRecentConcurrentActivity(currentEntity: any, updatedEntity: any): boolean {
    const currentTime = new Date(currentEntity.updatedAt || currentEntity.createdAt || 0).getTime();
    const updatedTime = new Date(updatedEntity.updatedAt || updatedEntity.createdAt || 0).getTime();
    
    if (isNaN(currentTime) || isNaN(updatedTime)) {
      return false; // Can't determine concurrency without valid timestamps
    }

    const timeDiff = Math.abs(currentTime - updatedTime);
    
    // Consider concurrent if updates are within 5 minutes of each other
    const CONCURRENT_WINDOW = 5 * 60 * 1000; // 5 minutes
    return timeDiff < CONCURRENT_WINDOW;
  }

  /**
   * Resolve conflicts for additive numerical fields
   * This preserves operations rather than overwriting values
   */
  private async resolveAdditiveConflicts(currentEntity: any, updatedEntity: any, metadata: Operation['metadata']): Promise<any> {
    console.log('🧮 Resolving additive conflicts for entity:', currentEntity.id);
    
    const resolved = { ...currentEntity };
    
    // For Products: Calculate stock delta and apply both changes
    if (currentEntity.currentStock !== undefined && updatedEntity.currentStock !== undefined) {
      // We don't have access to base version in current implementation
      // So we'll use a simpler approach: average the differences for safety
      const currentStock = currentEntity.currentStock;
      const updatedStock = updatedEntity.currentStock;
      
      // If one value is clearly an addition/subtraction, preserve it
      if (updatedStock > currentStock) {
        // This looks like stock was added
        resolved.currentStock = updatedStock;
        console.log('📦 Stock increase detected - accepting higher value:', updatedStock);
      } else if (updatedStock < currentStock) {
        // This could be stock sold - need to be careful
        // For now, use the lower value (conservative approach)
        resolved.currentStock = updatedStock;
        console.log('📦 Stock decrease detected - accepting lower value (sale):', updatedStock);
      }
    }
    
    // For Players: Handle balance changes more carefully
    if (currentEntity.balance !== undefined && updatedEntity.balance !== undefined) {
      const currentBalance = currentEntity.balance;
      const updatedBalance = updatedEntity.balance;
      
      if (updatedBalance > currentBalance) {
        // Balance increased - accept the higher value
        resolved.balance = updatedBalance;
        console.log('💰 Balance increase detected - accepting higher value:', updatedBalance);
      } else {
        // Balance decreased - this could be a purchase, accept lower value
        resolved.balance = updatedBalance;
        console.log('💰 Balance decrease detected - accepting lower value (purchase):', updatedBalance);
      }
      
      // Also update totalSpent if it exists and is higher
      if (updatedEntity.totalSpent !== undefined && 
          updatedEntity.totalSpent > (currentEntity.totalSpent || 0)) {
        resolved.totalSpent = updatedEntity.totalSpent;
      }
      
      // Update totalPurchases if it's higher
      if (updatedEntity.totalPurchases !== undefined &&
          updatedEntity.totalPurchases > (currentEntity.totalPurchases || 0)) {
        resolved.totalPurchases = updatedEntity.totalPurchases;
      }
    }
    
    // Use the newer timestamp for metadata
    const currentTimestamp = new Date(currentEntity.updatedAt || currentEntity.createdAt || 0).getTime();
    const updatedTimestamp = new Date(updatedEntity.updatedAt || updatedEntity.createdAt || 0).getTime();
    
    if (!isNaN(updatedTimestamp) && updatedTimestamp > currentTimestamp) {
      resolved.updatedAt = updatedEntity.updatedAt;
      if (updatedEntity.version) {
        resolved.version = updatedEntity.version;
      }
    }
    
    console.log('✅ Additive conflict resolution complete for:', currentEntity.id);
    return resolved;
  }

  // ============================================
  // PUBLIC API - ALL WRITES GO THROUGH APPLYOP
  // ============================================

  /**
   * Create operation - wrapper around applyOp
   */
  public async createEntity(collection: string, data: any): Promise<string> {
    const entityId = data.id || generateUUID();
    const operation: Operation = {
      id: generateUUID(),
      type: 'create',
      collection: collection as any,
      entityId,
      data: { ...data, id: entityId },
      metadata: {
        deviceId: this.deviceId,
        timestamp: Date.now(),
        version: this.incrementVectorClock(),
        vectorClock: Object.fromEntries(this.vectorClock),
        source: 'local'
      }
    };

    await this.applyOp(operation);
    return entityId;
  }

  /**
   * Update operation - wrapper around applyOp
   */
  public async updateEntity(collection: string, entityId: string, updates: any): Promise<void> {
    const operation: Operation = {
      id: generateUUID(),
      type: 'update',
      collection: collection as any,
      entityId,
      data: updates,
      metadata: {
        deviceId: this.deviceId,
        timestamp: Date.now(),
        version: this.incrementVectorClock(),
        vectorClock: Object.fromEntries(this.vectorClock),
        source: 'local'
      }
    };

    await this.applyOp(operation);
  }

  /**
   * Delete operation - wrapper around applyOp
   */
  public async deleteEntity(collection: string, entityId: string): Promise<void> {
    console.log(`🗑️ Deleting entity via unified system: ${collection}/${entityId}`);
    
    const operation: Operation = {
      id: generateUUID(),
      type: 'delete',
      collection: collection as any,
      entityId,
      data: {}, // Delete operations don't need data
      metadata: {
        deviceId: this.deviceId,
        timestamp: Date.now(),
        version: this.incrementVectorClock(),
        vectorClock: Object.fromEntries(this.vectorClock),
        source: 'local'
      }
    };

    await this.applyOp(operation);
    console.log(`✅ Entity deleted via unified system: ${collection}/${entityId}`);
  }

  // ============================================
  // BATCH/GROUPED OPERATIONS FOR UI DISPLAY
  // ============================================

  /**
   * Create entity with batch grouping - wrapper around createEntity
   */
  public async createEntityWithBatch(collection: string, data: any, batchId: string, batchLabel: string): Promise<string> {
    // Add batch info to the data for tracking
    const dataWithBatch = { ...data, batchId, batchLabel };
    return this.createEntity(collection, dataWithBatch);
  }

  /**
   * Update entity with batch grouping - wrapper around updateEntity
   */
  public async updateEntityWithBatch(collection: string, entityId: string, updates: any, batchId: string, batchLabel: string): Promise<void> {
    // Add batch info to the updates for tracking
    const updatesWithBatch = { ...updates, batchId, batchLabel };
    return this.updateEntity(collection, entityId, updatesWithBatch);
  }

  /**
   * Delete entity with batch grouping - wrapper around deleteEntity
   */
  public async deleteEntityWithBatch(collection: string, entityId: string, batchId: string, batchLabel: string): Promise<void> {
    // For deletes, we'll need to modify the applyOp to handle batch info
    return this.deleteEntity(collection, entityId);
  }

  /**
   * Compound Assignment Transaction - Creates assignment and updates related entities atomically
   * 
   * This method handles the complete sale transaction:
   * 1. Creates the assignment record
   * 2. Reduces product stock
   * 3. Updates player balance and stats
   * 
   * All updates happen atomically in a single operation to prevent sync conflicts
   */
  public async createAssignmentTransaction(assignmentData: {
    productId: string;
    productName: string;
    userName: string;
    playerId: string;
    quantity: number;
    unitPrice: number;
    total: number;
    organizationId: string;
    notes?: string;
  }): Promise<string> {
    console.log('🔄 Creating assignment transaction with BUNDLE approach:', {
      player: assignmentData.userName,
      product: assignmentData.productName,
      quantity: assignmentData.quantity,
      total: assignmentData.total
    });

    // Use the new bundle-based approach from MD
    const bundleId = await this.createAssignmentBundle({
      productId: assignmentData.productId,
      productName: assignmentData.productName,
      userName: assignmentData.userName,
      playerId: assignmentData.playerId,
      quantity: assignmentData.quantity,
      unitPrice: assignmentData.unitPrice,
      total: assignmentData.total,
      organizationId: assignmentData.organizationId
    });

    console.log(`✅ Assignment transaction completed with bundle: ${bundleId}`);
    return bundleId;
  }

  // ============================================
  // VECTOR CLOCK SUPPORT
  // ============================================

  private generateDeviceId(): string {
    // Generate persistent device ID or retrieve from storage
    return `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async initializeVectorClock(): Promise<void> {
    try {
      // Load existing vector clock from storage
      const clockData = await AsyncStorage.getItem('vector_clock');
      if (clockData) {
        const clockObj = JSON.parse(clockData);
        this.vectorClock = new Map(Object.entries(clockObj));
      }
      
      // Initialize this device's counter
      if (!this.vectorClock.has(this.deviceId)) {
        this.vectorClock.set(this.deviceId, 0);
        await this.saveVectorClock();
      }
      
      console.log('🕐 Vector clock initialized:', {
        deviceId: this.deviceId,
        clockSize: this.vectorClock.size
      });
    } catch (error) {
      console.error('❌ Error initializing vector clock:', error);
    }
  }

  private async saveVectorClock(): Promise<void> {
    try {
      const clockObj = Object.fromEntries(this.vectorClock);
      await AsyncStorage.setItem('vector_clock', JSON.stringify(clockObj));
    } catch (error) {
      console.error('❌ Error saving vector clock:', error);
    }
  }

  private incrementVectorClock(): number {
    const currentValue = this.vectorClock.get(this.deviceId) || 0;
    const newValue = currentValue + 1;
    this.vectorClock.set(this.deviceId, newValue);
    this.saveVectorClock(); // Fire and forget
    return newValue;
  }

  private createVersionVector(): any {
    return {
      deviceId: this.deviceId,
      version: this.incrementVectorClock(),
      timestamp: Date.now(),
      vectorClock: Object.fromEntries(this.vectorClock)
    };
  }

  // ============================================
  // ATOMIC OUTBOX TRANSACTIONS
  // ============================================

  /**
   * Performs atomic outbox operation: updates local data + sync queue together
   * This ensures consistency between local state and outbox queue
   */
  private async performAtomicOutboxWrite<T>(
    storageKey: string,
    updateOperation: (currentData: T[]) => T[],
    queueItem: Omit<SyncQueueItem, 'timestamp' | 'retryCount'>
  ): Promise<void> {
    try {
      // Get current data
      const currentDataStr = await AsyncStorage.getItem(storageKey);
      const currentData: T[] = currentDataStr ? JSON.parse(currentDataStr) : [];
      
      // Apply update operation
      const updatedData = updateOperation(currentData);
      
      // Prepare batch operations
      const operations = [
        AsyncStorage.setItem(storageKey, JSON.stringify(updatedData)),
        this.addToSyncQueueAtomic(queueItem)
      ];
      
      // Execute atomically
      await Promise.all(operations);
      
      console.log(`💾 Atomic outbox write completed for ${storageKey}`, {
        itemCount: updatedData.length,
        queueItemId: queueItem.id
      });
      
    } catch (error) {
      console.error(`❌ Atomic outbox write failed for ${storageKey}:`, error);
      throw error;
    }
  }

  private async addToSyncQueueAtomic(item: Omit<SyncQueueItem, 'timestamp' | 'retryCount'>): Promise<void> {
    this.syncQueue.push({
      ...item,
      timestamp: Date.now(),
      retryCount: 0
    });
    await this.saveSyncQueue();
  }

  // ============================================
  // NETWORK MONITORING
  // ============================================
  
  private async initializeNetworkListener(): Promise<void> {
    // Get initial network state
    const netInfo = await NetInfo.fetch();
    this.isOnline = netInfo.isConnected ?? false;
    
    console.log('🌐 Network initialized', {
      isConnected: netInfo.isConnected,
      type: netInfo.type,
      isInternetReachable: netInfo.isInternetReachable,
      details: netInfo.details
    });
    
    // Listen for network changes
    NetInfo.addEventListener((state: NetInfoState) => {
      const wasOffline = !this.isOnline;
      const previousOnlineState = this.isOnline;
      
      // More strict offline detection - check both connection AND internet reachability
      const newOnlineState = (state.isConnected === true) && (state.isInternetReachable !== false);
      this.isOnline = newOnlineState;
      
      console.log('📡 Network state changed', {
        previousState: previousOnlineState,
        newState: this.isOnline,
        rawIsConnected: state.isConnected,
        rawIsInternetReachable: state.isInternetReachable,
        type: state.type,
        details: state.details,
        queueLength: this.syncQueue.length,
        timestamp: new Date().toLocaleTimeString()
      });
      
      // If we just came back online, trigger sync AND resurrect dead letter queue items
      if (wasOffline && this.isOnline) {
        console.log('📶 Network restored, triggering sync...', {
          queueLength: this.syncQueue.length,
          deadLetterLength: this.deadLetterQueue.length
        });
        
        // CRITICAL FIX: Resurrect items from dead letter queue when connectivity restored
        this.resurrectDeadLetterQueueItems().then(() => {
          this.processSyncQueue();
        }).catch((error: any) => {
          console.error('❌ Failed to resurrect dead letter queue items:', error);
          this.processSyncQueue(); // Still try to process main queue
        });
      }
      
      // If we just went offline
      if (!wasOffline && !this.isOnline) {
        console.log('📵 Network lost - switching to offline mode');
      }
    });
  }

  // ============================================
  // SYNC QUEUE MANAGEMENT
  // ============================================
  
  private async loadSyncQueue(): Promise<void> {
    try {
      const queueData = await AsyncStorage.getItem(this.syncQueueKey);
      const rawQueue: SyncQueueItem[] = queueData ? JSON.parse(queueData) : [];
      
      // Validate and filter out corrupted items
      const validItems: SyncQueueItem[] = [];
      const invalidItems: any[] = [];
      const orphanedProductItems: any[] = [];
      
      for (const item of rawQueue) {
        if (this.isValidSyncQueueItem(item)) {
          // Additional validation for product operations - check if product exists
          if (item.collection === 'products' && (item.action === 'update' || item.action === 'delete')) {
            const productExists = await this.checkProductExists(item.id);
            if (!productExists) {
              orphanedProductItems.push(item);
              console.warn('🗑️ Found orphaned product sync item (product no longer exists):', {
                productId: item.id,
                action: item.action,
                data: item.data,
                timestamp: new Date(item.timestamp).toISOString()
              });
              continue;
            }
          }
          // Additional validation for assignment operations - check if assignment exists
          else if (item.collection === 'assignments' && (item.action === 'update' || item.action === 'delete')) {
            const assignmentExists = await this.checkAssignmentExists(item.id);
            if (!assignmentExists) {
              orphanedProductItems.push(item); // Reusing the same array for simplicity
              console.warn('🗑️ Found orphaned assignment sync item (assignment no longer exists):', {
                assignmentId: item.id,
                action: item.action,
                data: item.data,
                timestamp: new Date(item.timestamp).toISOString()
              });
              continue;
            }
          }
          validItems.push(item);
        } else {
          invalidItems.push(item);
          console.warn('⚠️ Found invalid sync queue item:', {
            item: item,
            missingFields: this.getMissingFields(item)
          });
        }
      }
      
      this.syncQueue = validItems;
      
      console.log(`📋 Loaded sync queue: ${validItems.length} valid items, ${invalidItems.length} invalid items, ${orphanedProductItems.length} orphaned product items filtered out`);
      
      if (invalidItems.length > 0 || orphanedProductItems.length > 0) {
        // Save the cleaned queue back to storage
        await this.saveSyncQueue();
        console.log('🧹 Cleaned and saved sync queue after filtering invalid/orphaned items');
      }

      // If we still have a suspicious number of items, log details for debugging
      if (validItems.length > 5) {
        console.log('⚠️ Large sync queue detected - running debug inspection');
        await this.debugSyncQueue();
      }
      
    } catch (error) {
      console.error('Error loading sync queue:', error);
      this.syncQueue = [];
    }
  }

  private isValidSyncQueueItem(item: any): item is SyncQueueItem {
    return item && 
           typeof item.id === 'string' &&
           typeof item.collection === 'string' &&
           typeof item.action === 'string' &&
           item.data !== null &&
           item.data !== undefined &&
           typeof item.timestamp === 'number' &&
           typeof item.retryCount === 'number';
  }

  private getMissingFields(item: any): string[] {
    const required = ['id', 'collection', 'action', 'data', 'timestamp', 'retryCount'];
    const missing: string[] = [];
    
    for (const field of required) {
      if (!item || item[field] === null || item[field] === undefined) {
        missing.push(field);
      }
    }
    
    return missing;
  }

  private async checkProductExists(productId: string): Promise<boolean> {
    try {
      const products = await this.getLocalData('products');
      const productExists = products.some((product: any) => product.id === productId);
      console.log(`🔍 Product existence check: ${productId} = ${productExists}`);
      return productExists;
    } catch (error) {
      console.error('Error checking product existence:', error);
      return false; // Assume doesn't exist if we can't check
    }
  }

  private async checkAssignmentExists(assignmentId: string): Promise<boolean> {
    try {
      const assignments = await this.getLocalData('assignments');
      const assignmentExists = assignments.some((assignment: any) => assignment.id === assignmentId);
      console.log(`🔍 Assignment existence check: ${assignmentId} = ${assignmentExists}`);
      return assignmentExists;
    } catch (error) {
      console.error('Error checking assignment existence:', error);
      return false; // Assume doesn't exist if we can't check
    }
  }

  private async checkProductExistsInFirebase(productId: string): Promise<boolean> {
    try {
      if (!this.isOnline) {
        console.log(`🔍 Firebase existence check skipped (offline): ${productId}`);
        return true; // Assume exists when offline to avoid removing valid operations
      }
      
      const products = await firebaseService.getProducts();
      const exists = products.some(product => product.id === productId);
      console.log(`🔍 Firebase product existence check: ${productId} = ${exists}`);
      return exists;
    } catch (error: any) {
      if (error.message && (
          error.message.includes('not found') || 
          error.message.includes('No document to update') ||
          error.message.toLowerCase().includes('no document to update')
        )) {
        console.log(`🔍 Firebase product existence check: ${productId} = false (not found)`);
        return false;
      }
      console.error('Error checking Firebase product existence:', error);
      return true; // Assume exists on error to avoid removing valid operations
    }
  }

  /**
   * Debug method to inspect sync queue contents
   */
  public async debugSyncQueue(): Promise<void> {
    console.log('🔍 === SYNC QUEUE DEBUG INSPECTION ===');
    console.log(`📊 Total items in sync queue: ${this.syncQueue.length}`);
    
    if (this.syncQueue.length === 0) {
      console.log('✅ Sync queue is empty');
      return;
    }

    // Group by collection and action
    const grouped: { [key: string]: SyncQueueItem[] } = {};
    
    for (const item of this.syncQueue) {
      const key = `${item.collection}_${item.action}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
    }

    // Log summary
    console.log('📋 Sync queue breakdown:');
    for (const [key, items] of Object.entries(grouped)) {
      console.log(`  ${key}: ${items.length} items`);
    }

    // Log detailed information for each item
    console.log('📝 Detailed sync queue items:');
    for (let i = 0; i < this.syncQueue.length; i++) {
      const item = this.syncQueue[i];
      const age = Date.now() - item.timestamp;
      const ageMinutes = Math.round(age / (1000 * 60));
      
      console.log(`  ${i + 1}. ${item.collection}/${item.action} (${item.id})`);
      console.log(`     Age: ${ageMinutes} minutes`);
      console.log(`     Retry count: ${item.retryCount}`);
      console.log(`     Data keys: ${item.data ? Object.keys(item.data).join(', ') : 'no data'}`);
      
      // Special handling for products - check if they exist
      if (item.collection === 'products') {
        const exists = await this.checkProductExists(item.id);
        console.log(`     Product exists: ${exists}`);
        if (!exists) {
          console.log(`     ⚠️  ORPHANED: Product ${item.id} no longer exists!`);
        }
      }
      // Special handling for assignments - check if they exist
      else if (item.collection === 'assignments') {
        const exists = await this.checkAssignmentExists(item.id);
        console.log(`     Assignment exists: ${exists}`);
        if (!exists) {
          console.log(`     ⚠️  ORPHANED: Assignment ${item.id} no longer exists!`);
        }
      }
    }
    
    console.log('🔍 === END SYNC QUEUE DEBUG ===');
  }

  /**
   * Clean orphaned and invalid items from sync queue
   */
  public async cleanSyncQueue(): Promise<{ removed: number; kept: number }> {
    console.log('🧹 Starting sync queue cleanup...');
    
    const originalCount = this.syncQueue.length;
    const validItems: SyncQueueItem[] = [];
    let removedCount = 0;

    for (const item of this.syncQueue) {
      let shouldKeep = true;

      // Check if item is valid
      if (!this.isValidSyncQueueItem(item)) {
        console.log(`🗑️ Removing invalid sync item: ${(item as any)?.id || 'unknown'}`);
        shouldKeep = false;
        removedCount++;
      }
      // Check if product operations reference existing products
      else if (item.collection === 'products' && (item.action === 'update' || item.action === 'delete')) {
        const productExists = await this.checkProductExists(item.id);
        if (!productExists) {
          console.log(`🗑️ Removing orphaned product sync item: ${item.id} (${item.action})`);
          shouldKeep = false;
          removedCount++;
        }
      }
      // Check if assignment operations reference existing assignments
      else if (item.collection === 'assignments' && (item.action === 'update' || item.action === 'delete')) {
        const assignmentExists = await this.checkAssignmentExists(item.id);
        if (!assignmentExists) {
          console.log(`🗑️ Removing orphaned assignment sync item: ${item.id} (${item.action})`);
          shouldKeep = false;
          removedCount++;
        }
      }
      // Check age - remove items older than 1 hour that have high retry counts
      else if (item.retryCount >= this.maxRetries / 2) {
        const age = Date.now() - item.timestamp;
        const oneHour = 60 * 60 * 1000;
        if (age > oneHour) {
          console.log(`🗑️ Removing stale sync item: ${item.id} (age: ${Math.round(age / (1000 * 60))} minutes, retries: ${item.retryCount})`);
          shouldKeep = false;
          removedCount++;
        }
      }

      if (shouldKeep) {
        validItems.push(item);
      }
    }

    this.syncQueue = validItems;
    await this.saveSyncQueue();

    const result = { removed: removedCount, kept: validItems.length };
    console.log(`✅ Sync queue cleanup completed: removed ${result.removed}, kept ${result.kept}`);
    
    return result;
  }

  private async saveSyncQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(this.syncQueueKey, JSON.stringify(this.syncQueue));
    } catch (error) {
      console.error('Error saving sync queue:', error);
    }
  }

  private addToSyncQueue(item: Omit<SyncQueueItem, 'timestamp' | 'retryCount'>): void {
    // Check for duplicates before adding
    const existingItem = this.syncQueue.find(qItem => 
      qItem.id === item.id && 
      qItem.collection === item.collection && 
      qItem.action === item.action
    );
    
    if (existingItem) {
      console.warn(`⚠️ DUPLICATE SYNC ITEM DETECTED - Not adding:`, {
        itemId: item.id,
        collection: item.collection,
        action: item.action,
        existingTimestamp: new Date(existingItem.timestamp).toISOString(),
        attemptedTimestamp: new Date().toISOString()
      });
      return; // Don't add duplicate
    }
    
    const syncItem: SyncQueueItem = {
      ...item,
      timestamp: Date.now(),
      retryCount: 0
    };
    
    this.syncQueue.push(syncItem);
    this.saveSyncQueue();
    console.log(`➕ Added ${item.action} ${item.collection} to sync queue: ${item.id}`);
    console.log(`📊 Sync queue now has ${this.syncQueue.length} items`);
    
    // Log detailed breakdown if queue is getting large
    if (this.syncQueue.length > 3) {
      const breakdown: { [key: string]: number } = {};
      this.syncQueue.forEach(qItem => {
        const key = `${qItem.collection}_${qItem.action}`;
        breakdown[key] = (breakdown[key] || 0) + 1;
      });
      console.log('📋 Queue breakdown:', breakdown);
    }
  }

  private removeFromSyncQueue(id: string): void {
    this.syncQueue = this.syncQueue.filter(item => item.id !== id);
    this.saveSyncQueue();
  }

  // ============================================
  // BACKGROUND SYNC
  // ============================================
  
  private startBackgroundSync(): void {
    console.log('🔄 Starting enterprise outbox draining timers...');
    
    // High Priority: Every 5 seconds for critical operations (payments, assignments)
    this.highPriorityInterval = setInterval(async () => {
      const auth = FirebaseAuth;
      const hasHighPriority = this.hasHighPriorityItems();
      if (this.isOnline && auth.currentUser && hasHighPriority && !this.isSyncing) {
        console.log(`🚨 High priority bidirectional sync triggered - ${this.syncQueue.length} items`);
        try {
          // Push critical changes immediately
          await this.processSyncQueue();
          
          // Pull server changes to ensure immediate visibility of concurrent operations
          console.log('📥 High priority: Pulling server changes for immediate visibility');
          await this.hydrateFromServerForStartup();
          console.log('✅ High priority bidirectional sync completed');
        } catch (error) {
          console.warn('❌ High priority bidirectional sync failed gracefully:', error);
        }
      }
    }, 5000);

    // Normal Priority: Every 15 seconds for regular sync items
    this.syncInterval = setInterval(async () => {
      const auth = FirebaseAuth;
      if (this.isOnline && auth.currentUser && !this.isSyncing) {
        if (this.syncQueue.length > 0) {
          console.log(`📤 Regular outbox drain triggered: ${this.syncQueue.length} items queued`);
          try {
            // Push local changes first
            await this.processSyncQueue();
            
            // Lightweight server check: only pull if we just synced items
            // This ensures immediate visibility of changes from other devices
            console.log('📥 Background: Quick server changes check after outbox drain');
            await this.hydrateFromServerForStartup();
            console.log('✅ Background bidirectional sync completed');
          } catch (error) {
            console.warn('❌ Background bidirectional sync failed gracefully:', error);
          }
        }
      } else if (this.syncQueue.length > 0) {
        console.log(`📤 Sync skipped - online: ${this.isOnline}, user: ${!!auth.currentUser}, syncing: ${this.isSyncing}, queue: ${this.syncQueue.length}`);
      }
    }, 15000);

    // Low Priority: Every 60 seconds for comprehensive conflict detection and cleanup
    this.conflictDetectionInterval = setInterval(() => {
      const auth = FirebaseAuth;
      if (this.isOnline && auth.currentUser && !this.isSyncing) {
        this.performConflictDetectionSync();
        this.cleanupProcessedIds(); // Prevent memory bloat
      }
    }, 60000);

    // Comprehensive Server Sync: Every 5 minutes for full server changes check
    this.serverChangesInterval = setInterval(() => {
      const auth = FirebaseAuth;
      if (this.isOnline && auth.currentUser && !this.isSyncing) {
        console.log('🔄 Background: Comprehensive server changes check (5-minute cycle)');
        this.hydrateFromServerForStartup().catch(error => {
          console.warn('Background server hydration failed:', error);
        });
      }
    }, 300000); // 5 minutes

    // Dead Letter Queue Processing: Every 10 minutes
    this.deadLetterInterval = setInterval(() => {
      const auth = FirebaseAuth;
      if (this.isOnline && auth.currentUser && this.deadLetterQueue.length > 0) {
        this.processDeadLetterQueue();
      }
    }, 600000); // 10 minutes

    // Recovery mechanism: Check for stuck sync every 2 minutes
    this.stuckSyncInterval = setInterval(() => {
      this.checkForStuckSync();
    }, 120000); // 2 minutes

    // Legacy player balance sync removed - now handled via applyOp operations
    // All balance updates flow through the unified write path automatically
  }

  // Legacy player balance sync removed - now handled via applyOp operations
  // All balance updates flow through the unified write path automatically

  private async performConflictDetectionSync(): Promise<void> {
    try {
      // Simple background sync without full conflict resolution to avoid heavy operations
      // Just try to sync pending items gracefully
      if (this.syncQueue.length > 0) {
        await this.processSyncQueue();
      }
    } catch (error) {
      // Silently handle background sync errors
    }
  }

  /**
   * Check for stuck sync operations and recover
   */
  private checkForStuckSync(): void {
    if (this.isSyncing && this.syncStartTime > 0) {
      const syncDuration = Date.now() - this.syncStartTime;
      const maxSyncTime = 5 * 60 * 1000; // 5 minutes max sync time
      
      if (syncDuration > maxSyncTime) {
        console.warn(`⚠️ Sync operation stuck for ${Math.round(syncDuration / 1000)}s - forcing recovery`);
        this.isSyncing = false;
        this.syncStartTime = 0;
        
        // Log current state for debugging
        console.log('🔍 Stuck sync recovery - current state:', {
          queueLength: this.syncQueue.length,
          deadLetterLength: this.deadLetterQueue.length,
          isOnline: this.isOnline,
          processedIdsCount: this.processedIds.size
        });
      }
    }
  }

  public async processSyncQueue(): Promise<void> {
    return this.drainOutboxWithTransaction();
  }

  // ============================================
  // ENTERPRISE OUTBOX DRAINING
  // ============================================

  /**
   * Enterprise-grade outbox draining with idempotent transactions
   * Processes items in atomic batches with proper error handling
   */
  private async drainOutboxWithTransaction(): Promise<void> {
    if (this.isSyncing || !this.isOnline) {
      return;
    }

    // Check both sync queue and pending bundles
    const pendingBundles = await this.getPendingBundles();
    if (this.syncQueue.length === 0 && pendingBundles.length === 0) {
      return;
    }

    this.isSyncing = true;
    this.syncStartTime = Date.now();
    
    try {
      // Process pending bundles first (atomic operations)
      if (pendingBundles.length > 0) {
        console.log(`📦 Processing ${pendingBundles.length} pending bundles`);
        await this.processPendingBundles(pendingBundles);
      }

      // Get items ready for processing with idempotency check
      const itemsToProcess = await this.getItemsReadyForSync();
      
      if (itemsToProcess.length === 0) {
        return;
      }

      console.log(`🔄 Draining outbox: ${itemsToProcess.length} items in ${Math.ceil(itemsToProcess.length / this.batchSize)} batches`);
      
      // Process in atomic batches
      const batches = this.createBatches(itemsToProcess, this.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`📦 Processing batch ${i + 1}/${batches.length} (${batch.length} items)`);
        
        await this.processBatchTransaction(batch);
        
        // Small delay between batches to prevent overwhelming the server
        if (i < batches.length - 1) {
          await this.delay(100); // 100ms between batches
        }
      }
      
      console.log('✅ Outbox drain completed successfully');
      
    } catch (error) {
      console.error('❌ Outbox drain failed:', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : 'No stack trace',
        pendingBundlesCount: pendingBundles.length,
        queueLength: this.syncQueue.length,
        isOnline: this.isOnline
      });
      
      // Log the specific sync queue items that might be causing issues
      if (this.syncQueue.length > 0) {
        console.error('🔍 Current sync queue items causing issues:');
        this.syncQueue.slice(0, 5).forEach((item, index) => {
          console.error(`  Item ${index + 1}:`, {
            id: item.id,
            collection: item.collection,
            action: item.action,
            retryCount: item.retryCount,
            dataKeys: item.data ? Object.keys(item.data) : 'NO DATA'
          });
        });
      }
    } finally {
      this.isSyncing = false;
      this.syncStartTime = 0;
    }
  }

  /**
   * Get items ready for sync with idempotency filtering
   */
  private async getItemsReadyForSync(): Promise<SyncQueueItem[]> {
    const currentTime = Date.now();
    
    return this.syncQueue.filter(item => {
      // Skip if already processed (idempotency)
      if (this.processedIds.has(item.id)) {
        console.log(`⏭️ Skipping already processed item: ${item.id}`);
        return false;
      }
      
      // Skip if not ready for retry (backoff delay)
      if (item.timestamp > currentTime) {
        return false;
      }
      
      return true;
    }).sort((a, b) => a.timestamp - b.timestamp); // Oldest first for FIFO processing
  }

  /**
   * Process a batch of items as an atomic transaction
   */
  private async processBatchTransaction(batch: SyncQueueItem[]): Promise<void> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`🔄 Starting transaction ${batchId} with ${batch.length} items`);
    
    const processedInBatch: string[] = [];
    const failedInBatch: { item: SyncQueueItem, error: any }[] = [];
    
    try {
      // Process each item in the batch
      for (const item of batch) {
        try {
          // Double-check idempotency at item level
          if (this.processedIds.has(item.id)) {
            console.log(`⏭️ Item ${item.id} already processed, skipping`);
            continue;
          }
          
          await this.syncItemIdempotent(item);
          
          // Mark as processed for idempotency
          this.processedIds.add(item.id);
          processedInBatch.push(item.id);
          
          console.log(`✅ Processed item ${item.id} in batch ${batchId}`);
          
        } catch (error) {
          console.error(`❌ Item ${item.id} failed in batch ${batchId}:`, {
            itemId: item.id,
            collection: item.collection,
            action: item.action,
            retryCount: item.retryCount,
            dataKeys: item.data ? Object.keys(item.data) : 'NO DATA',
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : 'No stack trace'
          });
          failedInBatch.push({ item, error }); // Capture both item and error
        }
      }
      
      // Atomic cleanup: Remove successful items from queue
      if (processedInBatch.length > 0) {
        this.removeMultipleFromSyncQueue(processedInBatch);
        console.log(`🧹 Removed ${processedInBatch.length} processed items from queue`);
      }
      
      // Handle failed items with retry logic or dead letter queue
      if (failedInBatch.length > 0) {
        await this.handleFailedItemsWithErrors(failedInBatch, batchId);
      }
      
    } catch (batchError) {
      console.error(`❌ Batch transaction ${batchId} failed:`, batchError);
      // Rollback: Remove idempotency markers for this batch
      processedInBatch.forEach(id => this.processedIds.delete(id));
      throw batchError;
    }
    
    // Persist queue changes
    await this.saveSyncQueue();
    
    console.log(`✅ Batch transaction ${batchId} completed: ${processedInBatch.length} success, ${failedInBatch.length} failed`);
  }

  /**
   * Idempotent sync item processing - safe to call multiple times
   */
  private async syncItemIdempotent(item: SyncQueueItem): Promise<void> {
    // Check if this specific operation was already completed successfully
    const operationKey = `${item.collection}_${item.action}_${item.id}`;
    
    try {
      await this.syncItem(item);
      
      // Mark operation as completed for future idempotency checks
      console.log(`✅ Idempotent sync completed: ${operationKey}`);
      
    } catch (error) {
      console.error(`❌ Idempotent sync failed: ${operationKey}`, error);
      throw error;
    }
  }

  /**
   * Create batches from items array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Remove multiple items from sync queue atomically
   */
  private removeMultipleFromSyncQueue(ids: string[]): void {
    this.syncQueue = this.syncQueue.filter(item => !ids.includes(item.id));
  }

  /**
   * Handle failed items with dead letter queue
   * ENHANCED: Smart failure detection - distinguishes network issues from real errors
   */
  private async handleFailedItems(failedItems: SyncQueueItem[], batchId: string, error?: any): Promise<void> {
    for (const item of failedItems) {
      const queueItem = this.syncQueue.find(q => q.id === item.id);
      if (queueItem) {
        // ENHANCED: Determine if this is a real failure or just network issues
        const isRealFailure = this.isRealFailure(error);
        const shouldIncrementRetry = this.isOnline && isRealFailure;
        
        if (shouldIncrementRetry) {
          queueItem.retryCount = (queueItem.retryCount || 0) + 1;
          console.log(`🔄 Real failure - incrementing retry count to ${queueItem.retryCount} for item: ${item.id}`);
        } else if (!this.isOnline) {
          console.log(`📴 Offline failure - NOT incrementing retry count for item: ${item.id}`);
        } else {
          console.log(`📶 Network issue (not real failure) - NOT incrementing retry count for item: ${item.id}, error: ${error?.message || 'unknown'}`);
        }
        
        // Only move to dead letter queue for REAL failures, not network issues
        if (shouldIncrementRetry && queueItem.retryCount >= this.maxRetries) {
          console.warn(`💀 Moving item to dead letter queue after ${this.maxRetries} REAL failures: ${item.id}`);
          console.warn(`💀 Final error was: ${error?.message || 'unknown'}`);
          this.deadLetterQueue.push({ ...queueItem });
          this.removeFromSyncQueue(item.id);
          
          // Persist dead letter queue
          await this.saveDeadLetterQueue();
        } else {
          // Schedule retry with smart backoff
          let backoffDelay = this.calculateRetryDelay(queueItem, isRealFailure);
          queueItem.timestamp = Date.now() + backoffDelay;
          
          const retryReason = !this.isOnline ? 'offline' : 
                             !isRealFailure ? 'network issue' : 
                             'real failure';
          console.log(`⏳ Retry scheduled in ${Math.round(backoffDelay/1000)}s for ${item.id} (${retryReason})`);
        }
      }
    }
  }

  /**
   * ENHANCED: Determine if error represents a real failure vs temporary network issue
   */
  private isRealFailure(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || '';
    
    // Network/connectivity issues (NOT real failures)
    const networkIssues = [
      'network request failed',
      'network error',
      'timeout',
      'connection timeout',
      'socket timeout',
      'request timeout',
      'fetch timeout',
      'connection reset',
      'connection refused',
      'network is unreachable',
      'temporary failure',
      'service unavailable',
      'server is busy',
      'too many requests',
      'rate limit',
      'gateway timeout',
      'bad gateway',
      'service temporarily unavailable'
    ];
    
    // HTTP status codes that indicate temporary issues (NOT real failures)
    const temporaryStatusCodes = ['503', '502', '504', '429', '408', '500'];
    
    // Check if this is a temporary network issue
    const isNetworkIssue = networkIssues.some(issue => errorMessage.includes(issue)) ||
                          temporaryStatusCodes.some(code => errorCode.includes(code) || errorMessage.includes(code));
    
    if (isNetworkIssue) {
      console.log(`📶 Detected network issue (not real failure): ${errorMessage}`);
      return false;
    }
    
    // Real failures (should count as retries)
    const realFailures = [
      'not found',
      'unauthorized',
      'forbidden',
      'bad request',
      'invalid',
      'malformed',
      'permission denied',
      'quota exceeded',
      'conflict',
      'gone',
      'payload too large',
      'unsupported media type'
    ];
    
    const isRealError = realFailures.some(failure => errorMessage.includes(failure));
    
    if (isRealError) {
      console.log(`❌ Detected real failure: ${errorMessage}`);
      return true;
    }
    
    // Default: treat unknown errors as network issues (be conservative)
    console.log(`🤔 Unknown error type, treating as network issue: ${errorMessage}`);
    return false;
  }

  /**
   * ENHANCED: Calculate smart retry delay based on failure type
   */
  private calculateRetryDelay(queueItem: SyncQueueItem, isRealFailure: boolean): number {
    if (!this.isOnline) {
      // Short delay for offline items
      return 30000; // 30 seconds
    }
    
    if (!isRealFailure) {
      // Network issues: shorter, less aggressive backoff
      const networkRetryCount = Math.min(queueItem.retryCount || 0, 5); // Cap at 5 for network issues
      return Math.min(5000 * Math.pow(1.5, networkRetryCount), 60000); // Max 1 minute for network issues
    } else {
      // Real failures: traditional exponential backoff
      return Math.min(1000 * Math.pow(2, queueItem.retryCount || 0), 300000); // Max 5 minutes
    }
  }

  /**
   * Handle failed items with error context for smarter retry logic
   */
  private async handleFailedItemsWithErrors(failedItems: { item: SyncQueueItem, error: any }[], batchId: string): Promise<void> {
    for (const { item, error } of failedItems) {
      const queueItem = this.syncQueue.find(q => q.id === item.id);
      if (queueItem) {
        // Use the enhanced failure detection with actual error
        const isRealFailure = this.isRealFailure(error);
        const shouldIncrementRetry = this.isOnline && isRealFailure;
        
        if (shouldIncrementRetry) {
          queueItem.retryCount = (queueItem.retryCount || 0) + 1;
          console.log(`🔄 Real failure - incrementing retry count to ${queueItem.retryCount} for item: ${item.id}`);
        } else if (!this.isOnline) {
          console.log(`📴 Offline failure - NOT incrementing retry count for item: ${item.id}`);
        } else {
          console.log(`📶 Network issue (not real failure) - NOT incrementing retry count for item: ${item.id}, error: ${error?.message || 'unknown'}`);
        }
        
        // Use different retry limits for real failures vs network issues
        const maxRetriesForThisError = isRealFailure ? this.maxRetries : this.maxNetworkRetries;
        
        // Only move to dead letter queue if we've exceeded the appropriate retry limit
        if (shouldIncrementRetry && queueItem.retryCount >= maxRetriesForThisError) {
          const failureType = isRealFailure ? 'REAL failures' : 'network issues';
          console.warn(`💀 Moving item to dead letter queue after ${maxRetriesForThisError} ${failureType}: ${item.id}`);
          console.warn(`💀 Final error was: ${error?.message || 'unknown'}`);
          this.deadLetterQueue.push({ ...queueItem });
          this.removeFromSyncQueue(item.id);
          
          // Persist dead letter queue
          await this.saveDeadLetterQueue();
        } else {
          // Schedule retry with smart backoff
          let backoffDelay = this.calculateRetryDelay(queueItem, isRealFailure);
          queueItem.timestamp = Date.now() + backoffDelay;
          
          const retryReason = !this.isOnline ? 'offline' : 
                             !isRealFailure ? 'network issue' : 
                             'real failure';
          const retriesUsed = queueItem.retryCount || 0;
          const maxRetries = isRealFailure ? this.maxRetries : this.maxNetworkRetries;
          console.log(`⏳ Retry ${retriesUsed}/${maxRetries} scheduled in ${Math.round(backoffDelay/1000)}s for ${item.id} (${retryReason})`);
        }
      }
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Save dead letter queue to persistent storage
   */
  private async saveDeadLetterQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem('dead_letter_queue', JSON.stringify(this.deadLetterQueue));
    } catch (error) {
      console.error('❌ Error saving dead letter queue:', error);
    }
  }

  /**
   * CRITICAL FIX: Move items from dead letter queue back to main queue when connectivity restored
   * This fixes the issue where offline assignments get stuck in dead letter queue
   */
  private async resurrectDeadLetterQueueItems(): Promise<void> {
    if (this.deadLetterQueue.length === 0) {
      console.log('✅ No items in dead letter queue to resurrect');
      return;
    }

    console.log(`♻️ Resurrecting ${this.deadLetterQueue.length} items from dead letter queue`);

    // Move all dead letter items back to main queue with reset retry counts
    const itemsToResurrect = this.deadLetterQueue.map(item => ({
      ...item,
      retryCount: 0, // Reset retry count since we're now online
      timestamp: Date.now() // Set immediate processing
    }));

    // Add to main sync queue
    this.syncQueue.push(...itemsToResurrect);

    // Clear the dead letter queue
    this.deadLetterQueue = [];

    // Save both queues
    await Promise.all([
      this.saveSyncQueue(),
      this.saveDeadLetterQueue()
    ]);

    console.log(`✅ Resurrected ${itemsToResurrect.length} items - sync queue now has ${this.syncQueue.length} items`);

    // Log what was resurrected for debugging
    itemsToResurrect.forEach((item: any) => {
      console.log(`♻️ Resurrected: ${item.collection} ${item.action} - ${item.id}`);
    });
  }

  private async syncItem(item: SyncQueueItem): Promise<void> {
    console.log(`🔄 syncItem - Processing item:`, {
      itemId: item.id,
      action: item.action,
      collection: item.collection,
      dataKeys: item.data ? Object.keys(item.data) : 'NO DATA',
      timestamp: item.timestamp,
      retryCount: item.retryCount
    });

    try {
      switch (item.collection) {
        case 'products':
          return this.syncProductItem(item);
        case 'staff-users':
          return this.syncUserItem(item);
        case 'assignments':
          return this.syncAssignmentItem(item);
        case 'players':
          return this.syncPlayerItem(item);
        case 'reports':
          return this.syncReportItem(item);
        case 'charges':
          return this.syncChargeItem(item);
        case 'organizations':
          return this.syncOrganizationItem(item);
        default:
          console.error(`❌ Unknown collection in syncItem: ${item.collection}`, {
            itemId: item.id,
            action: item.action,
            availableCollections: ['products', 'staff-users', 'assignments', 'players', 'reports', 'charges', 'organizations']
          });
          throw new Error(`Unknown collection: ${item.collection}`);
      }
    } catch (error) {
      console.error(`❌ syncItem failed for ${item.collection}/${item.action}/${item.id}:`, error);
      throw error;
    }
  }

  private async syncProductItem(item: SyncQueueItem): Promise<void> {
    console.log('🔄 syncProductItem - Processing item:', {
      itemId: item.id,
      action: item.action,
      collection: item.collection,
      dataKeys: item.data ? Object.keys(item.data) : 'NO DATA',
      hasValidData: !!item.data,
      timestamp: item.timestamp,
      retryCount: item.retryCount
    });

    // Validate item data
    if (!item.data) {
      throw new Error(`Invalid sync item: missing data for product ${item.id}`);
    }

    switch (item.action) {
      case 'create':
        // Clean product data before sending to Firebase (same as syncOpToServer)
        const { 
          entityId, 
          metadata, 
          vectorClock, 
          version, 
          deviceId, 
          timestamp,
          createdAt, 
          updatedAt, 
          ...cleanProductData 
        } = item.data;
        
        console.log('🔄 Cleaned product data for Firebase (sync queue):', {
          original: item.data,
          cleaned: cleanProductData,
          removedFields: { entityId, metadata, vectorClock, version, deviceId, timestamp, createdAt, updatedAt }
        });
        
        await firebaseService.addProduct(cleanProductData);
        break;
      case 'update':
        // Validate update data
        if (!item.data || typeof item.data !== 'object') {
          throw new Error(`Invalid update data for product ${item.id}: ${JSON.stringify(item.data)}`);
        }

        // Check for undefined values
        const undefinedKeys = Object.keys(item.data).filter(key => item.data[key] === undefined);
        if (undefinedKeys.length > 0) {
          console.warn('⚠️ SYNC QUEUE - Found undefined values in product update:', undefinedKeys);
          // Clean the data
          const cleanData = { ...item.data };
          undefinedKeys.forEach(key => delete cleanData[key]);
          item.data = cleanData;
          console.log('� SYNC QUEUE - Cleaned update data:', cleanData);
        }

        console.log('�🔄 SYNC QUEUE - Product update operation:', {
          itemId: item.id,
          dataId: item.data.id,
          data: item.data,
          dataKeys: Object.keys(item.data),
          usingId: item.id // Use the same logic as syncOpToServer
        });
        // Check if product still exists locally (for logging, but don't skip if missing)
        const actualProductId = item.data.entityId || item.data.id || item.id;
        const productExists = await this.checkProductExists(actualProductId);
        if (!productExists) {
          console.warn('⚠️ SYNC QUEUE - Product not found in local cache, but attempting Firebase update anyway:', actualProductId);
          // Don't return - continue with Firebase update as product might exist on server
        }
        
        try {
          const productId = item.data.entityId || item.data.id || item.id; // Use entityId first, then fallback
          await firebaseService.updateProduct(productId, item.data);
          console.log('✅ SYNC QUEUE - Product updated successfully in Firebase:', {
            productId: productId,
            updatedFields: Object.keys(item.data || {}),
            hasStockUpdate: item.data?.stock !== undefined,
            itemId: item.id
          });
        } catch (error: any) {
          // Check if error is due to product not existing in Firebase
          if (error.message && (
              error.message.includes('not found') || 
              error.message.includes('No document to update') ||
              error.message.includes('Product with logical ID') && error.message.includes('not found') ||
              error.message.toLowerCase().includes('no document to update')
            )) {
            console.warn('⚠️ SYNC QUEUE - Product no longer exists in Firebase, skipping update:', {
              productId: item.id,
              error: error.message,
              updateData: item.data
            });
            return; // Skip this operation instead of retrying
          }
          
          console.error('❌ Failed to update product in Firebase:', {
            productId: item.id,
            data: item.data,
            error: error.message,
            errorCode: error.code,
            fullError: error
          });
          throw error; // Re-throw to trigger retry mechanism for other errors
        }
        break;
      case 'delete':
        try {
          await firebaseService.deleteProduct(item.data.id);
          console.log('✅ Product deleted from Firebase:', item.data.id);
        } catch (error: any) {
          // Handle case where document doesn't exist (already deleted or never existed)
          if (error?.message?.includes('No document to update') || 
              error?.code === 'not-found' || 
              error?.message?.includes('not-found')) {
            console.log('📝 Product already deleted or never existed in Firebase:', item.data.id);
            // Treat as successful - the end result is the same (product is gone)
            return;
          }
          // Re-throw other errors
          throw error;
        }
        break;
    }
  }

  private async syncUserItem(item: SyncQueueItem): Promise<void> {
    switch (item.action) {
      case 'create':
        await firebaseService.addUser(item.data);
        break;
      case 'update':
        await firebaseService.updateUser(item.data.uid, item.data);
        break;
      case 'delete':
        // Mark user as inactive instead of deleting
        await firebaseService.updateUser(item.data.uid, { isActive: false });
        break;
    }
  }

  private async syncAssignmentItem(item: SyncQueueItem): Promise<void> {
    switch (item.action) {
      case 'create':
        // Clean assignment data before sending to Firebase (same as syncOpToServer)
        const { 
          entityId: _entityId, 
          metadata: _metadata, 
          vectorClock, 
          version, 
          deviceId, 
          timestamp,
          createdAt, 
          updatedAt, 
          ...cleanAssignmentData 
        } = item.data;
        
        console.log('🔄 Cleaned assignment data for Firebase (sync queue):', {
          original: item.data,
          cleaned: cleanAssignmentData,
          removedFields: { _entityId, _metadata, vectorClock, version, deviceId, timestamp, createdAt, updatedAt }
        });
        
        // Simple approach: Let Firebase generate the ID and use it everywhere
        const firebaseId = await firebaseService.addAssignment(cleanAssignmentData);
        
        // Update local storage to use the Firebase ID
        const localAssignments = await this.getLocalAssignments();
        const assignmentIndex = localAssignments.findIndex(a => a.id === item.data.id);
        if (assignmentIndex >= 0) {
          // Replace the assignment with Firebase ID
          localAssignments[assignmentIndex] = { ...localAssignments[assignmentIndex], id: firebaseId };
          await AsyncStorage.setItem('assignments', JSON.stringify(localAssignments));
          console.log(`✅ Assignment synced to Firebase with ID: ${firebaseId}`);
        }
        break;
      case 'update':
        console.log(`🔄 Syncing assignment update:`, {
          queueItemId: item.id,
          dataKeys: Object.keys(item.data),
          itemData: item.data
        });
        
        // For assignment updates, we need to find the assignment ID
        // It could be in item.data.entityId (from applyOp) or item.data.id (old format)
        const assignmentId = item.data.entityId || item.data.id;
        
        if (!assignmentId) {
          console.error('Assignment update missing ID:', item.data);
          throw new Error('Assignment update missing assignment ID');
        }
        
        // Create clean update object without metadata fields
        const { entityId, metadata, ...updateData } = item.data;
        
        // Check if assignment still exists locally before attempting Firebase update
        const assignmentExists = await this.checkAssignmentExists(assignmentId);
        if (!assignmentExists) {
          console.log('⚠️ SYNC QUEUE - Assignment no longer exists locally, skipping update:', assignmentId);
          return; // Skip this operation
        }
        
        try {
          if (!firebaseService.isReady()) {
            throw new Error('FirebaseService is not ready. Organization ID not set.');
          }
          await firebaseService.updateAssignment(assignmentId, updateData);
          console.log('✅ Assignment updated successfully in Firebase:', assignmentId);
        } catch (error: any) {
          // Check if error is due to assignment not existing in Firebase
          if (error.message && error.message.includes('not found')) {
            console.log('⚠️ SYNC QUEUE - Assignment no longer exists in Firebase, skipping update:', assignmentId);
            return; // Skip this operation instead of retrying
          }
          
          console.error('❌ Failed to update assignment in Firebase:', {
            assignmentId,
            updateData,
            error: error.message,
            errorCode: error.code,
            fullError: error
          });
          throw error; // Re-throw to trigger retry mechanism for other errors
        }
        break;
      case 'delete':
        const deleteAssignmentId = item.data.entityId || item.data.id;
        if (!deleteAssignmentId) {
          throw new Error('Assignment delete missing assignment ID');
        }
        await firebaseService.deleteAssignment(deleteAssignmentId);
        console.log('✅ Assignment deleted from Firebase:', deleteAssignmentId);
        break;
    }
  }



  private async syncPlayerItem(item: SyncQueueItem): Promise<void> {
    try {
      console.log('🔄 SYNC PLAYER ITEM:', {
        action: item.action,
        playerId: item.data.id || item.data.entityId,
        hasData: !!item.data,
        itemId: item.id
      });
      
      const fbService = firebaseService;
      
      switch (item.action) {
        case 'create':
          console.log('🔄 Syncing player CREATE to Firebase - Raw item.data:', item.data);
          
          // CRITICAL FIX: Extract only player fields from operation data
          // item.data may contain operation metadata, we need just the player fields
          const { 
            entityId, 
            metadata, 
            vectorClock, 
            version, 
            deviceId, 
            timestamp,
            createdAt, 
            updatedAt, 
            ...cleanPlayerData 
          } = item.data;
          
          console.log('🔄 Cleaned player data for Firebase:', {
            original: item.data,
            cleaned: cleanPlayerData,
            removedFields: { entityId, metadata, vectorClock, version, deviceId, timestamp, createdAt, updatedAt }
          });
          
          // Validate we have essential player fields
          if (!cleanPlayerData.firstName || !cleanPlayerData.lastName || !cleanPlayerData.id) {
            console.error('❌ Missing essential player fields:', cleanPlayerData);
            throw new Error('Invalid player data - missing firstName, lastName, or id');
          }
          
          // Check if player already exists in Firebase (prevent duplicates)
          try {
            const existingPlayers = await fbService.getPlayers();
            const existingPlayer = existingPlayers.find(p => p.id === cleanPlayerData.id);
            
            if (existingPlayer) {
              console.log('⚠️ Player already exists in Firebase, skipping create:', cleanPlayerData.id);
              return; // Skip this sync operation
            }
          } catch (error) {
            console.warn('⚠️ Could not check for existing players, proceeding with create:', error);
          }
          
          await fbService.addPlayer(cleanPlayerData);
          console.log('✅ Player CREATE synced to Firebase with clean data');
          break;
          
        case 'updateBalance':
          const { amount, isDebit } = item.data;
          const playerId = item.data.id || item.data.entityId; // Use same logic as the log
          
          console.log('💰 DEBUG BALANCE UPDATE:', {
            playerId,
            amount,
            isDebit,
            itemId: item.id,
            fullItemData: item.data
          });
          
          // Legacy balance update - assume it's not a purchase to avoid incorrect stats
          await fbService.updatePlayerBalance(playerId, amount, isDebit, false);
          console.log('✅ Player balance update synced to Firebase (legacy):', {
            playerId,
            amount,
            isDebit,
            isPurchase: false
          });
          break;
          
        case 'update':
          console.log('🔄 Syncing player UPDATE to Firebase:', {
            playerId: item.data.id,
            updates: item.data
          });
          
          // FIXED: FirebaseService.updatePlayer handles logical UUID mapping internally
          const playerUUID = item.data.id || item.data.entityId;
          if (!playerUUID) {
            throw new Error('No player UUID provided for update');
          }
          
          console.log('🔍 Updating player with logical UUID:', { uuid: playerUUID, data: item.data });
          
          // Update using logical UUID - Firebase service handles the mapping internally
          await fbService.updatePlayer(playerUUID, item.data);
          console.log('✅ Player UPDATE synced to Firebase');
          break;
          
        default:
          console.warn('❌ Unknown player action:', item.action);
          throw new Error(`Unknown player action: ${item.action}`);
      }
    } catch (error) {
      console.error('❌ Error syncing player item:', error);
      throw error;
    }
  }

  private async syncReportItem(item: SyncQueueItem): Promise<void> {
    switch (item.action) {
      case 'create':
        await firebaseService.addReport(item.data);
        break;
      case 'update':
        // For now, skip update as reports don't have update method
        console.log('Report update not implemented yet');
        break;
      case 'delete':
        // For now, skip delete as reports don't have delete method  
        console.log('Report delete not implemented yet');
        break;
    }
  }

  private async syncChargeItem(item: SyncQueueItem): Promise<void> {
    console.log(`🔄 syncChargeItem - Processing charge ${item.action}:`, {
      itemId: item.id,
      action: item.action,
      dataKeys: item.data ? Object.keys(item.data) : 'NO DATA',
      timestamp: item.timestamp,
      retryCount: item.retryCount
    });

    try {
      // For now, skip charge sync as FirebaseService doesn't have individual charge methods
      // Charges are handled through bundle operations in the atomic transactions
      console.log('⚠️ Charge sync via individual operations not implemented - charges are handled via bundles');
      console.log('💳 Charge operation details:', {
        action: item.action,
        chargeId: item.data?.id,
        playerId: item.data?.playerId,
        amount: item.data?.amount,
        status: item.data?.status
      });
      
      // Mark as completed since bundles handle the actual Firebase operations
      console.log('✅ Charge sync skipped - handled by bundle operations');
    } catch (error) {
      console.error(`❌ syncChargeItem failed for ${item.action}/${item.id}:`, error);
      throw error;
    }
  }

  private async syncOrganizationItem(item: SyncQueueItem): Promise<void> {
    console.log(`🔄 syncOrganizationItem - Processing organization ${item.action}:`, {
      itemId: item.id,
      action: item.action,
      dataKeys: item.data ? Object.keys(item.data) : 'NO DATA',
      timestamp: item.timestamp,
      retryCount: item.retryCount
    });

    try {
      // For now, skip organization sync as individual methods may not exist
      // Organizations are handled through bundle operations in atomic transactions
      console.log('⚠️ Organization sync via individual operations not implemented - organizations are handled via bundles');
      console.log('🏢 Organization operation details:', {
        action: item.action,
        orgId: item.data?.id,
        name: item.data?.name,
        settingsKeys: item.data?.settings ? Object.keys(item.data.settings) : 'NO SETTINGS'
      });
      
      // Mark as completed since bundles handle the actual Firebase operations
      console.log('✅ Organization sync skipped - handled by bundle operations');
    } catch (error) {
      console.error(`❌ syncOrganizationItem failed for ${item.action}/${item.id}:`, error);
      throw error;
    }
  }

  // ============================================
  // PUBLIC API - HYBRID OPERATIONS
  // ============================================

  /**
   * Clean up problematic operations from sync queue
   * Removes operations that are likely to never succeed (like deleting non-existent items)
   */
  public async cleanupSyncQueue(): Promise<void> {
    console.log('🧹 Cleaning up problematic sync queue operations...');
    
    const initialCount = this.syncQueue.length;
    const problemOperations: string[] = [];
    
    // Find operations that have failed too many times with "not found" errors
    const itemsToRemove = this.syncQueue.filter(item => {
      // Remove delete operations that have retried too many times
      if (item.action === 'delete' && item.retryCount >= 2) {
        problemOperations.push(item.id);
        return true;
      }
      
      // Remove update operations for products that have failed with "not found" errors
      if (item.action === 'update' && item.collection === 'products' && item.retryCount >= 2) {
        problemOperations.push(item.id);
        console.log('🧹 Removing orphaned product update operation:', {
          itemId: item.id,
          productId: item.data?.id || item.data?.entityId,
          retryCount: item.retryCount
        });
        return true;
      }
      
      return false;
    });
    
    // Remove problematic operations
    this.syncQueue = this.syncQueue.filter(item => !problemOperations.includes(item.id));
    
    // Also clear dead letter queue of similar items
    const deadLetterInitialCount = this.deadLetterQueue.length;
    this.deadLetterQueue = this.deadLetterQueue.filter(item => {
      return !(item.action === 'delete' && item.collection === 'products');
    });
    
    // Save changes
    await this.saveSyncQueue();
    await this.saveDeadLetterQueue();
    
    console.log(`🧹 Cleanup completed: Removed ${itemsToRemove.length} operations from sync queue (${initialCount} -> ${this.syncQueue.length})`);
    console.log(`🧹 Cleanup completed: Removed ${deadLetterInitialCount - this.deadLetterQueue.length} items from dead letter queue`);
  }

  /**
   * Remove an entity from local cache only (bypass server sync)
   */
  public async removeFromLocalCache(collection: string, entityId: string): Promise<void> {
    try {
      console.log(`🗑️ Removing ${entityId} from local ${collection} cache`);
      const currentData = await this.getLocalData(collection);
      const filteredData = currentData.filter((item: any) => item.id !== entityId);
      await this.saveLocalData(collection, filteredData);
      console.log(`✅ Removed ${entityId} from local ${collection} cache`);
    } catch (error) {
      console.error(`❌ Failed to remove ${entityId} from local ${collection} cache:`, error);
      throw error;
    }
  }

  /**
   * Force clear all local data for a collection (emergency reset)
   */
  public async forceEmptyLocalCollection(collection: string): Promise<void> {
    try {
      console.log(`🧹 Force clearing all local ${collection} data`);
      await this.saveLocalData(collection, []);
      console.log(`✅ Force cleared all local ${collection} data`);
    } catch (error) {
      console.error(`❌ Failed to force clear local ${collection} data:`, error);
      throw error;
    }
  }

  /**
   * Remove sync queue items that reference non-existent entities
   */
  public async removeOrphanedSyncItems(): Promise<void> {
    console.log('🧹 Removing orphaned sync queue items...');
    
    const currentProducts = await this.getLocalData('products');
    const currentProductIds = new Set(currentProducts.map((p: any) => p.id));
    
    const initialCount = this.syncQueue.length;
    const orphanedItems: string[] = [];
    
    // Check each sync queue item
    this.syncQueue = this.syncQueue.filter(item => {
      if (item.collection === 'products') {
        const entityId = item.data?.id || item.data?.entityId;
        
        if (!currentProductIds.has(entityId)) {
          orphanedItems.push(item.id);
          console.log('🗑️ Removing orphaned product sync item:', {
            itemId: item.id,
            action: item.action,
            productId: entityId,
            retryCount: item.retryCount
          });
          return false; // Remove this item
        }
      }
      return true; // Keep this item
    });
    
    await this.saveSyncQueue();
    
    console.log(`🧹 Removed ${orphanedItems.length} orphaned sync items (${initialCount} -> ${this.syncQueue.length})`);
  }

  /**
   * Comprehensive cleanup for current sync issues
   * Call this once to fix the current problematic state
   */
  public async fixCurrentSyncIssues(): Promise<void> {
    console.log('🩺 Starting comprehensive sync issues fix...');
    
    try {
      // 1. Remove orphaned sync items first
      await this.removeOrphanedSyncItems();
      
      // 2. Clean up sync queue
      await this.cleanupSyncQueue();
      
      // 2. Remove duplicate products from local storage
      const productsStr = await AsyncStorage.getItem('products');
      if (productsStr) {
        const products = JSON.parse(productsStr);
        const uniqueProducts = [];
        const seenIds = new Set();
        
        for (const product of products) {
          if (!seenIds.has(product.id)) {
            seenIds.add(product.id);
            uniqueProducts.push(product);
          } else {
            console.log('🔄 Removing duplicate product:', product.id);
          }
        }
        
        await AsyncStorage.setItem('products', JSON.stringify(uniqueProducts));
        console.log(`🧹 Cleaned products: ${products.length} -> ${uniqueProducts.length} items`);
      }
      
      // 3. Remove any products marked as deleted
      const currentProducts = await this.getLocalProducts();
      const activeProducts = currentProducts.filter(p => !p.isDeleted);
      await AsyncStorage.setItem('products', JSON.stringify(activeProducts));
      console.log(`🗑️ Removed deleted products: ${currentProducts.length} -> ${activeProducts.length} items`);
      
      console.log('✅ Comprehensive sync issues fix completed successfully');
    } catch (error) {
      console.error('❌ Fix sync issues failed:', error);
      throw error;
    }
  }

  async addProduct(product: any): Promise<string> {
    console.log('📦 Adding product via applyOp system');
    
    // Generate UUID for the product
    const productId = generateUUID();
    const productWithId = { 
      ...product, 
      id: productId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    // Use the unified applyOp system
    await this.applyOp({
      id: generateUUID(),
      type: 'create',
      collection: 'products',
      entityId: productId,
      data: productWithId,
      metadata: {
        deviceId: this.deviceId,
        timestamp: Date.now(),
        version: 1,
        vectorClock: this.createVersionVector(),
        source: 'local'
      }
    });
    
    console.log('✅ Product added via applyOp:', productId);
    return productId;
  }

  public async updateProduct(id: string, updates: any): Promise<void> {
    console.log('📦 updateProduct - using unified applyOp system', {
      productId: id,
      updates: updates,
      updateKeys: Object.keys(updates || {}),
      isOnline: this.isOnline,
      timestamp: new Date().toLocaleTimeString(),
      currentSyncQueueSize: this.syncQueue.length
    });
    
    // Log current sync queue items for debugging
    console.log('📋 Current sync queue before product update:');
    this.syncQueue.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.collection}/${item.action} - ID: ${item.id} - Age: ${Math.round((Date.now() - item.timestamp) / 1000)}s - Retries: ${item.retryCount}`);
    });

    // ✅ CRITICAL VALIDATION: Ensure product ID is valid before any operations
    if (!id || typeof id !== 'string' || id.length === 0) {
      console.error('❌ CRITICAL: Invalid product ID passed to updateProduct:', {
        id: id,
        idType: typeof id,
        idLength: id?.length,
        updates: updates
      });
      throw new Error(`Invalid product ID: ${JSON.stringify(id)}`);
    }
    
    if (!updates || typeof updates !== 'object') {
      console.error('❌ CRITICAL: Invalid updates object passed to updateProduct:', {
        updates: updates,
        updatesType: typeof updates,
        productId: id
      });
      throw new Error(`Invalid updates object: ${JSON.stringify(updates)}`);
    }

    // ✅ EXISTENCE CHECK: Verify the product actually exists before updating
    try {
      const existingProducts = await this.getLocalData('products');
      const productExists = existingProducts.some((product: any) => product.id === id);
      
      console.log('🔍 PRODUCT EXISTENCE CHECK:', {
        productId: id,
        exists: productExists,
        totalProducts: existingProducts.length,
        existingProductIds: existingProducts.map((p: any) => p.id)
      });
      
      if (!productExists) {
        console.error('❌ CRITICAL: Product does not exist in local cache:', {
          productId: id,
          availableProducts: existingProducts.map((p: any) => ({ id: p.id, name: p.name }))
        });
        throw new Error(`Product with ID ${id} does not exist in local cache`);
      }
    } catch (error) {
      console.error('❌ Error checking product existence:', error);
      throw error;
    }

    // Check for undefined values in updates
    const undefinedKeys = Object.keys(updates).filter(key => updates[key] === undefined);
    if (undefinedKeys.length > 0) {
      console.warn('⚠️ Warning: undefined values in updates:', undefinedKeys);
      // Remove undefined values to prevent sync issues
      const cleanUpdates = { ...updates };
      undefinedKeys.forEach(key => delete cleanUpdates[key]);
      updates = cleanUpdates;
      console.log('📝 Cleaned updates (removed undefined):', updates);
    }

    // Use the unified applyOp system for consistency and reliability
    await this.applyOp({
      id: generateUUID(),
      type: 'update',
      collection: 'products',
      entityId: id,
      data: updates,
      metadata: {
        deviceId: this.deviceId,
        timestamp: Date.now(),
        version: 1,
        vectorClock: this.createVersionVector(),
        source: 'local'
      }
    });

    console.log('✅ Product update applied via applyOp system');
    console.log('🔍 PRODUCT UPDATE COMPLETE - Final sync queue size:', this.syncQueue.length);
    
    // Log final sync queue state
    console.log('📋 Final sync queue after product update:');
    this.syncQueue.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.collection}/${item.action} - ID: ${item.id} - Age: ${Math.round((Date.now() - item.timestamp) / 1000)}s - Retries: ${item.retryCount}`);
    });
  }

  public async deleteProduct(id: string): Promise<void> {
    try {
      if (this.isOnline) {
        // Try Firebase first
        try {
          await firebaseService.deleteProduct(id);
          console.log('✅ Product deleted from Firebase:', id);
        } catch (firebaseError: any) {
          // Handle case where document doesn't exist
          if (firebaseError?.message?.includes('No document to update') || 
              firebaseError?.code === 'not-found' || 
              firebaseError?.message?.includes('not-found')) {
            console.log('📝 Product already deleted or never existed in Firebase:', id);
            // Continue to remove from local storage
          } else {
            throw firebaseError;
          }
        }
        
        // Remove from local storage
        await this.removeLocalProduct(id);
      } else {
        throw new Error('Offline - using local storage');
      }
    } catch (error: any) {
      // Only queue for sync if it's not a "document not found" error
      if (!error?.message?.includes('No document to update') && 
          !error?.message?.includes('not-found')) {
        console.log('📱 Marking product as deleted locally and queueing for sync');
        
        // Check if this product is already queued for deletion to prevent duplicates
        const existingDeleteOp = this.syncQueue.find(item => 
          item.collection === 'products' && 
          item.action === 'delete' && 
          item.data?.id === id
        );
        
        if (!existingDeleteOp) {
          // Mark as deleted locally (soft delete)
          await this.updateLocalProduct(id, { isDeleted: true });
          
          // Add to sync queue
          this.addToSyncQueue({
            id: `delete_${generateUUID()}`,
            action: 'delete',
            collection: 'products',
            data: { id }
          });
          console.log('➕ Added delete products to sync queue');
        } else {
          console.log('⏭️ Product deletion already queued, skipping duplicate');
        }
      } else {
        // For "not found" errors, just remove locally
        await this.removeLocalProduct(id);
        console.log('📱 Removed non-existent product from local storage:', id);
      }
    }
  }

  // Similar methods for Users, Assignments, Reports...
  async addUser(user: any): Promise<string> {
    try {
      if (this.isOnline) {
        // Try Firebase first - Firebase will generate proper UUID automatically
        const firebaseId = await firebaseService.addUser(user);
        const localUsers = await this.getLocalUsers();
        localUsers.push({ ...user, id: firebaseId });
        await AsyncStorage.setItem('staff-users', JSON.stringify(localUsers));
        return firebaseId;
      } else {
        throw new Error('Offline - using local storage');
      }
    } catch (error) {
      console.log('📱 Saving user locally and queueing for sync');
      
      // Generate proper UUID for offline scenario
      const tempId = `offline_${generateUUID()}`;
      
      // Save locally with temp UUID
      const localUsers = await this.getLocalUsers();
      const userWithId = { ...user, id: tempId };
      localUsers.push(userWithId);
      await AsyncStorage.setItem('staff-users', JSON.stringify(localUsers));
      
      this.addToSyncQueue({
        id: tempId,
        action: 'create',
        collection: 'staff-users',
        data: userWithId
      });
      
      return tempId;
    }
  }

  async addAssignment(assignment: any): Promise<{ id: string; syncStatus: 'synced' | 'pending' }> {
    console.log('� Adding assignment via applyOp system');
    console.log('🔍 ASSIGNMENT CREATION DEBUG - Input data:', {
      assignment: assignment,
      currentSyncQueueSize: this.syncQueue.length,
      isOnline: this.isOnline
    });
    
    // Log current sync queue items for debugging
    console.log('📋 Current sync queue before assignment creation:');
    this.syncQueue.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.collection}/${item.action} - ID: ${item.id} - Age: ${Math.round((Date.now() - item.timestamp) / 1000)}s - Retries: ${item.retryCount}`);
    });
    
    // Generate UUID for the assignment
    const assignmentId = generateUUID();
    const assignmentWithId = { 
      ...assignment, 
      id: assignmentId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    console.log('🆔 Generated assignment ID:', assignmentId);
    
    try {
      // Use the unified applyOp system for both online and offline
      await this.applyOp({
          id: generateUUID(),
          type: 'create',
          collection: 'assignments',
          entityId: assignmentId,
          data: assignmentWithId,
          metadata: {
            deviceId: this.deviceId,
            timestamp: Date.now(),
            version: 1,
            vectorClock: this.createVersionVector(),
            source: 'local'
          }
        });
        console.log('✅ Assignment added via applyOp:', assignmentId);
        console.log('🔍 ASSIGNMENT CREATION COMPLETE - Final sync queue size:', this.syncQueue.length);
        
        // Log final sync queue state
        console.log('📋 Final sync queue after assignment creation:');
        this.syncQueue.forEach((item, index) => {
          console.log(`  ${index + 1}. ${item.collection}/${item.action} - ID: ${item.id} - Age: ${Math.round((Date.now() - item.timestamp) / 1000)}s - Retries: ${item.retryCount}`);
        });
        
        return { id: assignmentId, syncStatus: this.isOnline ? 'synced' : 'pending' };
    } catch (error) {
      console.error('❌ Error adding assignment via applyOp:', error);
      throw error;
    }
  }

  // ============================================
  // LOCAL DATA HELPERS
  // ============================================

  private async getLocalProducts(): Promise<any[]> {
    // Use the unified offline-first cache system
    return await this.getLocalData('products');
  }

  private async getLocalUsers(): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem('staff-users');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private async getLocalAssignments(): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem('assignments');
      if (!data) return [];
      
      const assignments = JSON.parse(data);
      
      // Validate and clean assignments data
      return assignments.map((assignment: any) => {
        // Ensure totalAmount/total is a valid number
        const total = assignment.totalAmount || assignment.total || 0;
        const validTotal = typeof total === 'number' && !isNaN(total) ? total : 0;
        
        return {
          ...assignment,
          totalAmount: validTotal,
          total: validTotal, // For backward compatibility
        };
      });
    } catch (error) {
      console.error('Error loading local assignments:', error);
      return [];
    }
  }

  private async updateLocalProduct(id: string, updates: any): Promise<void> {
    const products = await this.getLocalProducts();
    const index = products.findIndex(p => p.id === id);
    if (index !== -1) {
      products[index] = { ...products[index], ...updates };
      await AsyncStorage.setItem('products', JSON.stringify(products));
    }
  }

  private async removeLocalProduct(id: string): Promise<void> {
    const products = await this.getLocalProducts();
    const filtered = products.filter(p => p.id !== id);
    await AsyncStorage.setItem('products', JSON.stringify(filtered));
  }

  // ============================================
  // PUBLIC STATUS METHODS
  // ============================================

  public getConnectionStatus(): boolean {
    // Add real-time NetInfo check for debugging
    NetInfo.fetch().then(state => {
      if (state.isConnected !== this.isOnline) {
        console.warn('🚨 NetInfo vs Internal State Mismatch:', {
          netInfoConnected: state.isConnected,
          netInfoReachable: state.isInternetReachable,
          internalIsOnline: this.isOnline,
          netInfoType: state.type,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    });
    
    return this.isOnline;
  }

  public getSyncQueueLength(): number {
    return this.syncQueue.length;
  }

  /**
   * Get sync queue items grouped for UI display
   * Groups related operations (same batchId) into single items
   */
  public getSyncQueueGrouped(): Array<{
    id: string;
    label: string;
    count: number;
    timestamp: number;
    collections: string[];
    batchId?: string;
  }> {
    const groups = new Map<string, {
      id: string;
      label: string;
      count: number;
      timestamp: number;
      collections: Set<string>;
      batchId?: string;
    }>();

    // Group items by batchId or treat as individual items
    this.syncQueue.forEach(item => {
      const groupKey = item.batchId || item.id;
      
      if (groups.has(groupKey)) {
        const group = groups.get(groupKey)!;
        group.count++;
        group.collections.add(item.collection);
        // Use earliest timestamp
        group.timestamp = Math.min(group.timestamp, item.timestamp);
      } else {
        groups.set(groupKey, {
          id: groupKey,
          label: item.batchLabel || `${item.action} ${item.collection}`,
          count: 1,
          timestamp: item.timestamp,
          collections: new Set([item.collection]),
          batchId: item.batchId
        });
      }
    });

    // Convert to array and format collections
    return Array.from(groups.values()).map(group => ({
      ...group,
      collections: Array.from(group.collections)
    })).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get raw sync queue for debugging
   */
  public getSyncQueueRaw(): SyncQueueItem[] {
    return [...this.syncQueue];
  }

  /**
   * Debug method: Get all product IDs from local cache
   */
  public async debugProductIds(): Promise<{localProducts: any[], syncQueueItems: any[]}> {
    const localProducts = await this.getLocalData('products');
    const relevantSyncItems = this.syncQueue.filter(item => 
      item.collection === 'products' || 
      (item.collection === 'assignments' && item.data?.productId)
    );
    
    console.log('🔍 DEBUG - Local Products:', localProducts.map(p => ({id: p.id, name: p.name, stock: p.stock})));
    console.log('🔍 DEBUG - Sync Queue Product Items:', relevantSyncItems.map(item => ({
      id: item.id,
      collection: item.collection,
      action: item.action,
      productId: item.data?.productId || item.data?.entityId,
      data: item.data
    })));
    
    return { localProducts, syncQueueItems: relevantSyncItems };
  }

  // Debug methods for testing offline functionality
  public forceOfflineMode(): void {
    console.log('🧪 DEBUG: Forcing offline mode');
    this.isOnline = false;
  }

  public forceOnlineMode(): void {
    console.log('🧪 DEBUG: Forcing online mode');
    this.isOnline = true;
  }

  // Force refresh network state from NetInfo
  public async refreshNetworkState(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      const previousState = this.isOnline;
      this.isOnline = (state.isConnected === true) && (state.isInternetReachable !== false);
      
      console.log('🔄 Manual network state refresh:', {
        previous: previousState,
        current: this.isOnline,
        netInfoConnected: state.isConnected,
        netInfoReachable: state.isInternetReachable,
        type: state.type
      });
      
      return this.isOnline;
    } catch (error) {
      console.error('❌ Failed to refresh network state:', error);
      return this.isOnline;
    }
  }

  public async forcSync(): Promise<void> {
    console.log('🔄 Manual sync requested - full bidirectional sync');
    
    // Step 1: Push local changes to server
    console.log('📤 STEP 1: Pushing local changes to server...');
    await this.processSyncQueue();
    console.log('✅ STEP 1: Local changes pushed to server');
    
    // Step 2: Pull server changes to local
    console.log('📥 STEP 2: Pulling server changes to local (NEW PRODUCTS, PLAYERS, ASSIGNMENTS)...');
    try {
      await this.hydrateFromServerForStartup();
      console.log('✅ STEP 2: Server changes synchronized - new items should now be visible');
    } catch (error) {
      console.error('❌ STEP 2: Failed to pull server changes:', error);
      // Don't throw - outbound sync was successful
    }
    
    // Step 3: Sync player balances as part of full sync
    try {
      console.log('🔄 Syncing player balances...');
      await firebaseService.syncAllPlayerBalances();
      console.log('✅ Player balances synced');
    } catch (error) {
      console.error('❌ Failed to sync player balances:', error);
      // Don't throw - main sync was successful
    }
    
    console.log('✅ Manual sync completed - bidirectional sync finished');
  }

  public async clearSyncQueue(): Promise<void> {
    const itemCount = this.syncQueue.length;
    console.log(`🧹 CLEARING entire sync queue: ${itemCount} items`);
    
    // Log what we're clearing with special attention to charge items
    this.syncQueue.forEach((item, index) => {
      const itemType = item.collection === 'charges' ? '💰 CHARGE' : item.collection;
      console.log(`  Removing ${index + 1}. ${itemType}/${item.action} - ID: ${item.id} - Age: ${Math.round((Date.now() - item.timestamp) / 1000)}s`);
    });
    
    // Count charge-related items for extra logging
    const chargeItems = this.syncQueue.filter(item => item.collection === 'charges');
    if (chargeItems.length > 0) {
      console.log(`💰 Clearing ${chargeItems.length} charge-related sync items`);
    }
    
    this.syncQueue = [];
    await this.saveSyncQueue();
    console.log(`✅ CLEARED entire sync queue: ${itemCount} items removed (including ${chargeItems.length} charge items)`);
  }

  /**
   * Clean up orphaned sync operations (operations for entities that no longer exist)
   */
  public async cleanupOrphanedOperations(): Promise<void> {
    if (!this.isOnline) {
      console.log('📡 Skipping orphaned operations cleanup - offline');
      return;
    }

    console.log('🧹 Starting orphaned operations cleanup...');
    const originalCount = this.syncQueue.length;
    const orphanedItems: SyncQueueItem[] = [];
    const validItems: SyncQueueItem[] = [];

    for (const item of this.syncQueue) {
      let isOrphaned = false;

      // Check products
      if (item.collection === 'products' && (item.action === 'update' || item.action === 'delete')) {
        const exists = await this.checkProductExistsInFirebase(item.data?.id || item.id);
        if (!exists) {
          orphanedItems.push(item);
          isOrphaned = true;
          console.log(`🗑️ Found orphaned product operation: ${item.action} ${item.data?.id || item.id}`);
        }
      }
      // Check assignments
      else if (item.collection === 'assignments' && (item.action === 'update' || item.action === 'delete')) {
        const exists = await this.checkAssignmentExists(item.data?.id || item.id);
        if (!exists) {
          orphanedItems.push(item);
          isOrphaned = true;
          console.log(`🗑️ Found orphaned assignment operation: ${item.action} ${item.data?.id || item.id}`);
        }
      }

      if (!isOrphaned) {
        validItems.push(item);
      }
    }

    if (orphanedItems.length > 0) {
      this.syncQueue = validItems;
      await this.saveSyncQueue();
      console.log(`🧹 Cleaned up ${orphanedItems.length} orphaned operations (${originalCount} → ${validItems.length})`);
      
      // Log what was removed
      orphanedItems.forEach(item => {
        console.log(`  Removed: ${item.collection}/${item.action} - ${item.data?.id || item.id}`);
      });
    } else {
      console.log('✅ No orphaned operations found');
    }
  }

  /**
   * Clear all stuck sync data including provisional state (enhanced for new bundle system)
   */
  public async clearPendingBundles(): Promise<void> {
    console.log('🧹 Clearing pending bundles queue...');
    try {
      const bundlesData = await AsyncStorage.getItem('pending_bundles');
      const bundlesCount = bundlesData ? JSON.parse(bundlesData).length : 0;
      
      await AsyncStorage.removeItem('pending_bundles');
      console.log(`✅ Cleared ${bundlesCount} pending bundles`);
    } catch (error) {
      console.error('❌ Failed to clear pending bundles:', error);
      throw error;
    }
  }

  public async clearAllStuckData(): Promise<void> {
    console.log('🧹 Clearing ALL stuck sync data (queue, dead letter, bundles, provisional)...');
    
    try {
      // Clear main sync queue
      const queueCount = this.syncQueue.length;
      const deadCount = this.deadLetterQueue.length;
      
      this.syncQueue = [];
      await this.saveSyncQueue();
      
      // Clear dead letter queue
      this.deadLetterQueue = [];
      await AsyncStorage.removeItem('dead_letter_queue');
      
      // Clear provisional data from bundle system
      await AsyncStorage.removeItem('provisional_assignments');
      await AsyncStorage.removeItem('provisional_stock_deltas');
      await AsyncStorage.removeItem('provisional_balance_deltas');
      await AsyncStorage.removeItem('provisional_assignment_updates');
      await AsyncStorage.removeItem('provisional_organization_updates');
      await AsyncStorage.removeItem('provisional_charges');
      
      // Clear pending bundles queue
      await AsyncStorage.removeItem('pending_bundles');
      console.log('🧹 Pending bundles queue cleared');
      
      // Clear processed IDs cache
      this.processedIds?.clear();
      await AsyncStorage.removeItem('processed_ids');
      
      // Reset sync state
      this.isSyncing = false;
      
      console.log(`✅ All stuck sync data cleared - removed ${queueCount} queue + ${deadCount} dead letter + bundles + provisional data`);
      
    } catch (error) {
      console.error('❌ Failed to clear stuck data:', error);
      throw error;
    }
  }

  /**
   * Enable force server mode - temporarily accept all server data regardless of timestamps
   */
  public enableForceServerMode(): void {
    console.log('💪 HybridSyncService - Enabling force server mode (bypassing conflict resolution)');
    this.forceServerMode = true;
  }

  /**
   * Disable force server mode - return to normal conflict resolution
   */
  public disableForceServerMode(): void {
    console.log('🔒 HybridSyncService - Disabling force server mode (restoring conflict resolution)');
    this.forceServerMode = false;
  }

  /**
   * Clear provisional overlays for a specific collection (for force server refresh)
   */
  public async clearProvisionalOverlays(collection: string): Promise<void> {
    console.log('🧹 Clearing provisional overlays for collection:', collection);
    
    try {
      const provisionalKeys: Record<string, string | string[]> = {
        'products': 'provisional_stock_deltas',
        'players': 'provisional_balance_deltas', 
        'assignments': ['provisional_assignments', 'provisional_assignment_updates'],
        'organizations': 'provisional_organization_updates',
        'charges': 'provisional_charges'
      };
      
      const keysToRemove = provisionalKeys[collection];
      if (keysToRemove) {
        if (Array.isArray(keysToRemove)) {
          for (const key of keysToRemove) {
            await AsyncStorage.removeItem(key);
            console.log('🧹 Cleared provisional overlay:', key);
          }
        } else {
          await AsyncStorage.removeItem(keysToRemove);
          console.log('🧹 Cleared provisional overlay:', keysToRemove);
        }
        console.log('✅ Provisional overlays cleared for collection:', collection);
      } else {
        console.log('⚠️ No provisional overlays to clear for collection:', collection);
      }
    } catch (error) {
      console.error('❌ Failed to clear provisional overlays:', error);
      throw error;
    }
  }

  /**
   * Enhanced reset for sales data with bundle system support
   */
  public async resetAllSalesData(): Promise<void> {
    console.log('🔄 Starting ENHANCED sales data reset with bundle system...');
    
    try {
      // 1. Clear ALL stuck sync data first
      await this.clearAllStuckData();
      
      // 2. Delete all assignments locally
      await this.forceEmptyLocalCollection('assignments');
      
      // 3. Delete all charges locally
      await this.forceEmptyLocalCollection('charges');
      console.log('✅ Cleared local charges collection');
      
      // 4. Reset all player balances to zero locally
      const players = await this.getPlayers();
      console.log(`💰 Resetting ${players.length} player balances to zero...`);
      
      for (const player of players) {
        await this.applyOp({
          id: generateUUID(),
          type: 'update',
          collection: 'players',
          entityId: player.id,
          data: {
            balance: 0,
            totalSpent: 0,
            totalPurchases: 0,
            lastPurchaseDate: null
          },
          metadata: {
            deviceId: this.deviceId,
            timestamp: Date.now(),
            version: this.incrementVectorClock(),
            vectorClock: Object.fromEntries(this.vectorClock),
            source: 'local'
          }
        });
      }
      
      // 5. Try to delete assignments, charges and balance deltas from server (if online)
      if (this.isOnline) {
        try {
          if (!firebaseService.isReady()) {
            throw new Error('FirebaseService is not ready. Organization ID not set.');
          }
          
          // Delete all assignments from server
          const serverAssignments = await firebaseService.getAssignments();
          console.log(`🔥 Deleting ${serverAssignments.length} assignments from server...`);
          
          for (const assignment of serverAssignments) {
            try {
              await firebaseService.deleteAssignment(assignment.id!);
            } catch (error) {
              console.warn(`⚠️ Failed to delete server assignment ${assignment.id}:`, error);
            }
          }
          
          // Delete all charges from server
          const serverCharges = await firebaseService.getCharges();
          console.log(`🔥 Deleting ${serverCharges.length} charges from server...`);
          
          for (const charge of serverCharges) {
            try {
              await firebaseService.deleteCharge(charge.id!);
            } catch (error) {
              console.warn(`⚠️ Failed to delete server charge ${charge.id}:`, error);
            }
          }
          
          // Also clear all balance deltas from Firebase
          const serverPlayers = await firebaseService.getPlayers();
          console.log(`🔥 Clearing balance deltas for ${serverPlayers.length} players from server...`);
          
          for (const player of serverPlayers) {
            try {
              if (player.id) {
                console.log(`💰 RESET DEBUG - Player ${player.name}:`, {
                  currentBalance: player.balance,
                  totalSpent: player.totalSpent,
                  totalPurchases: player.totalPurchases
                });
                
                // Clear balance deltas subcollection first
                await firebaseService.clearPlayerBalanceDeltas(player.id);
                
                // Force reset server player balance to exactly zero
                await firebaseService.forceResetPlayerBalance(player.id);
                
                console.log(`✅ RESET COMPLETE - Player ${player.name} reset to zero`);
              }
            } catch (error) {
              console.error(`❌ RESET FAILED for player ${player.id}:`, error);
            }
          }
        } catch (error) {
          console.warn('⚠️ Failed to delete server data, but local reset completed:', error);
        }
      }
      
      // 6. Clear provisional stock deltas and charges
      await AsyncStorage.removeItem('provisional_stock_deltas');
      await AsyncStorage.removeItem('provisional_charges');
      console.log('✅ Cleared provisional stock deltas and charges');
      
      // 7. Clear cached reports
      await AsyncStorage.removeItem('reportData');
      await AsyncStorage.removeItem('topSelling');
      await AsyncStorage.removeItem('salesSummary');
      
      console.log('✅ Enhanced sales data reset completed');
      
    } catch (error) {
      console.error('❌ Enhanced sales reset failed:', error);
      throw error;
    }
  }

  /**
   * EMERGENCY: Clear all sync data and rebuild from scratch
   */
  public async emergencyCleanAndRebuild(): Promise<void> {
    console.log('🚨 === EMERGENCY CLEAN AND REBUILD ===');
    
    // Clear sync queue
    const queueCount = this.syncQueue.length;
    this.syncQueue = [];
    await this.saveSyncQueue();
    
    // Clear dead letter queue
    this.deadLetterQueue = [];
    await this.saveDeadLetterQueue();
    
    // Clear processed IDs (if exists)
    if (this.processedIds) {
      this.processedIds.clear();
    }
    
    console.log(`✅ EMERGENCY CLEAN: Removed ${queueCount} sync items, cleared all queues`);
    console.log('🚨 === END EMERGENCY CLEAN ===');
  }

  /**
   * Debug method to inspect and potentially clean specific legacy items
   */
  public async inspectAndCleanLegacyItems(): Promise<void> {
    console.log('🔍 === LEGACY ITEM INSPECTION ===');
    
    const now = Date.now();
    
    let removedCount = 0;
    const itemsToKeep: SyncQueueItem[] = [];
    
    for (const item of this.syncQueue) {
      const age = now - item.timestamp;
      const ageHours = Math.round(age / (60 * 60 * 1000));
      const shouldRemove = this.shouldRemoveLegacyItem(item, age);
      
      console.log(`📋 Item: ${item.collection}/${item.action} - ID: ${item.id}`);
      console.log(`   Age: ${ageHours} hours, Retries: ${item.retryCount}, Remove: ${shouldRemove}`);
      
      if (shouldRemove) {
        console.log(`   🗑️ REMOVING: ${item.collection}/${item.action} - ${item.id}`);
        removedCount++;
      } else {
        itemsToKeep.push(item);
      }
    }
    
    if (removedCount > 0) {
      this.syncQueue = itemsToKeep;
      await this.saveSyncQueue();
      console.log(`✅ Removed ${removedCount} legacy items, kept ${itemsToKeep.length}`);
    } else {
      console.log('✅ No legacy items found to remove');
    }
    
    console.log('🔍 === END LEGACY INSPECTION ===');
  }
  
  private shouldRemoveLegacyItem(item: SyncQueueItem, age: number): boolean {
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;
    
    // Remove items older than 1 day
    if (age > oneDay) {
      return true;
    }
    
    // Remove items older than 1 hour with high retry counts
    if (age > oneHour && item.retryCount >= 3) {
      return true;
    }
    
    // Remove items with excessive retry counts
    if (item.retryCount >= this.maxRetries) {
      return true;
    }
    
    return false;
  }

  /**
   * Debug method to check and fix product stock/quantity inconsistencies
   */
  public async fixProductStockInconsistencies(): Promise<void> {
    console.log('🔧 === PRODUCT STOCK CONSISTENCY CHECK ===');
    
    try {
      const products = await this.getLocalData('products');
      let fixedCount = 0;
      
      for (const product of products) {
        const stockValue = product.stock || 0;
        const quantityValue = product.quantity || 0;
        
        console.log(`📦 Product: ${product.name} (${product.id})`);
        console.log(`   Stock: ${stockValue}, Quantity: ${quantityValue}, Match: ${stockValue === quantityValue}`);
        
        // If they don't match, prioritize stock field and sync both
        if (stockValue !== quantityValue) {
          console.log(`   🔧 FIXING: Setting both stock and quantity to ${stockValue}`);
          
          const updateData = {
            stock: stockValue,
            quantity: stockValue,
            updatedAt: new Date().toISOString()
          };
          
          await this.updateProduct(product.id, updateData);
          fixedCount++;
        }
      }
      
      console.log(`✅ Fixed ${fixedCount} product inconsistencies`);
      
    } catch (error) {
      console.error('❌ Error fixing product inconsistencies:', error);
    }
    
    console.log('🔧 === END CONSISTENCY CHECK ===');
  }

  // ============================================
  // PUBLIC USER MANAGEMENT METHODS
  // ============================================

  public async getUsers(): Promise<string[]> {
    try {
      if (this.isOnline) {
        // Try to get from Firebase first
        const firebaseUsers = await firebaseService.getUsers();
        const userNames = firebaseUsers.map(user => {
          // Ensure consistent name format: use name field if present, otherwise combine firstName + lastName
          const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
          return user.name || fullName || 'Unknown User';
        });
        // Update local storage
        await AsyncStorage.setItem('staff-users', JSON.stringify(userNames));
        return userNames;
      } else {
        // Return from local storage
        const localUsers = await this.getLocalUsers();
        return Array.isArray(localUsers) && localUsers.length > 0 && typeof localUsers[0] === 'string' 
          ? localUsers 
          : localUsers.map((user: any) => typeof user === 'string' ? user : user.name || '');
      }
    } catch (error) {
      console.error('Error getting users:', error);
      return await this.getLocalUserNames();
    }
  }

  private async getLocalUserNames(): Promise<string[]> {
    try {
      const data = await AsyncStorage.getItem('staff-users');
      const users = data ? JSON.parse(data) : [];
      // Handle both string arrays and object arrays
      return Array.isArray(users) ? users.map((user: any) => typeof user === 'string' ? user : user.name || '') : [];
    } catch {
      return [];
    }
  }

  public async deleteUser(userName: string): Promise<void> {
    try {
      const currentUsers = await this.getUsers();
      const updatedUsers = currentUsers.filter(name => name !== userName);
      await AsyncStorage.setItem('staff-users', JSON.stringify(updatedUsers));
      
      // Add to sync queue if online
      if (this.isOnline) {
        this.addToSyncQueue({
          id: `delete_user_${userName}_${Date.now()}`,
          action: 'delete',
          collection: 'staff-users',
          data: { name: userName }
        });
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }

  // ============================================
  // PUBLIC ASSIGNMENT MANAGEMENT METHODS
  // ============================================

  public async getAssignments(): Promise<any[]> {
    console.log('📖 Reading assignments from local cache (single source of truth)');
    const localAssignments = await this.getLocalData('assignments');
    
    // Check if this is first-time access or cache needs refresh
    const isFirstTimeOrStale = await this.isFirstTimeOrStaleCache('assignments');
    
    if ((localAssignments.length === 0 || isFirstTimeOrStale) && this.isOnline) {
      console.log('📦 First-time access or stale cache - doing initial assignments sync');
      try {
        // Skip initial sync if no organization is set yet
        if (!firebaseService.isReady()) {
          console.log('⏭️ Skipping initial assignments sync - no organization set yet');
          return localAssignments;
        }
        
        const fbService = firebaseService;
        const serverAssignments = await fbService.getAssignments();
        
        await this.markCacheInitialized('assignments');
        await this.saveLocalData('assignments', serverAssignments);
        
        console.log('✅ Initial assignments sync completed:', serverAssignments.length);
        
        // Start background hydration
        this.hydrateAssignmentsFromServer().catch(error => {
          console.warn('⚠️ Background assignment hydration failed:', error);
        });
        
        return serverAssignments;
      } catch (error) {
        console.error('❌ Initial assignments sync failed:', error);
        return localAssignments;
      }
    } else if ((localAssignments.length === 0 || isFirstTimeOrStale) && !this.isOnline) {
      console.log('📱 Offline first-time access - no assignments available');
      return [];
    }
    
    // Cache has data - do background hydration as normal
    if (this.isOnline) {
      this.hydrateAssignmentsFromServer().catch(error => {
        console.warn('⚠️ Background assignment hydration failed:', error);
      });
    }
    
    console.log('✅ Returning local assignments:', localAssignments.length);
    return localAssignments;
  }

  /**
   * Background hydration from server - applies server updates via applyOp
   */
  public async hydrateAssignmentsFromServer(): Promise<void> {
    try {
      // Skip sync if no organization is set yet (e.g., during email verification)
      if (!firebaseService.isReady()) {
        console.log('⏭️ Skipping assignment hydration - no organization set yet');
        return;
      }
      
      console.log('🔄 Background: Hydrating assignments from server');
      const serverAssignments = await firebaseService.getAssignments();
      
      // Get current local assignments once for efficiency
      const localAssignments = await this.getLocalData('assignments');
      const localAssignmentIds = new Set(localAssignments.map(a => a.id));

      // Apply each server update via applyOp for consistency
      for (const serverAssignment of serverAssignments) {
        // Properly handle Firebase Timestamp objects
        let timestamp: number;
        try {
          console.log('🔍 Debug: serverAssignment.updatedAt:', serverAssignment.updatedAt, 'type:', typeof serverAssignment.updatedAt);
          
          if (serverAssignment.updatedAt?.seconds) {
            // Firebase Timestamp object - convert seconds to milliseconds
            timestamp = serverAssignment.updatedAt.seconds * 1000;
            // Add nanoseconds if available
            if (serverAssignment.updatedAt.nanoseconds) {
              timestamp += Math.floor(serverAssignment.updatedAt.nanoseconds / 1000000);
            }
            console.log('🔍 Converted Firebase Timestamp:', timestamp);
          } else if (serverAssignment.updatedAt?.toDate) {
            // Firebase Timestamp with toDate method
            timestamp = serverAssignment.updatedAt.toDate().getTime();
            console.log('🔍 Converted via toDate():', timestamp);
          } else if (typeof serverAssignment.updatedAt === 'string') {
            // ISO string - validate and convert to milliseconds
            const dateTest = new Date(serverAssignment.updatedAt);
            if (isNaN(dateTest.getTime())) {
              throw new Error(`Invalid ISO string: ${serverAssignment.updatedAt}`);
            }
            timestamp = dateTest.getTime();
            console.log('🔍 Converted ISO string:', serverAssignment.updatedAt, '→', timestamp);
          } else if (typeof serverAssignment.updatedAt === 'number') {
            // Already milliseconds
            timestamp = serverAssignment.updatedAt;
            console.log('🔍 Already number:', timestamp);
          } else {
            // Fallback to current time
            timestamp = Date.now();
            console.warn('⚠️ Could not parse updatedAt timestamp, using current time:', serverAssignment.updatedAt);
          }
          
          // Validate timestamp is reasonable (not too far in future or past)
          const now = Date.now();
          const oneYearMs = 365 * 24 * 60 * 60 * 1000;
          if (timestamp < now - oneYearMs || timestamp > now + oneYearMs) {
            console.warn('⚠️ Timestamp seems unreasonable, using current time:', new Date(timestamp));
            timestamp = now;
          }
          
        } catch (error) {
          console.warn('⚠️ Error processing timestamp, using current time:', error, 'Original:', serverAssignment.updatedAt);
          timestamp = Date.now();
        }

        // Determine if this is a new assignment or an update
        const isNewAssignment = !localAssignmentIds.has(serverAssignment.id);
        const operationType = isNewAssignment ? 'create' : 'update';

        console.log(`📋 Server assignment sync: ${operationType} - Assignment ${serverAssignment.id}`);

        const operation: Operation = {
          id: generateUUID(),
          type: operationType,
          collection: 'assignments',
          entityId: serverAssignment.id,
          data: serverAssignment,
          metadata: {
            deviceId: 'server',
            timestamp: timestamp,
            version: 0, // Server doesn't have vector clocks yet
            vectorClock: {},
            source: 'server'
          }
        };
        
        // Apply server updates via single write path
        await this.applyOp(operation);
      }
      
      // CRITICAL: Detect deletions by comparing local vs server data
      console.log('🔍 Checking for deleted assignments (server deletions)...');
      const serverAssignmentIds = new Set(serverAssignments.map(a => a.id));
      const deletedAssignments = localAssignments.filter(localAssignment => !serverAssignmentIds.has(localAssignment.id));
      
      for (const deletedAssignment of deletedAssignments) {
        console.log(`🗑️ Server deletion detected: Assignment ${deletedAssignment.id} no longer exists on server`);
        
        const deleteOperation: Operation = {
          id: generateUUID(),
          type: 'delete',
          collection: 'assignments',
          entityId: deletedAssignment.id,
          data: {},
          metadata: {
            deviceId: 'server',
            timestamp: Date.now(),
            version: 0,
            vectorClock: {},
            source: 'server'
          }
        };
        
        await this.applyOp(deleteOperation);
      }
      
      if (deletedAssignments.length > 0) {
        console.log(`✅ Processed ${deletedAssignments.length} server deletions for assignments`);
      }

      console.log('✅ Server assignment hydration completed via applyOp');
    } catch (error) {
      console.error('❌ Server assignment hydration failed:', error);
    }
  }

  // Merge assignments, preserving local changes like payment status
  private mergeAssignments(serverAssignments: any[], localAssignments: any[]): any[] {
    const merged = [...serverAssignments];
    
    // For each local assignment, check if it has changes that should be preserved
    localAssignments.forEach(localAssignment => {
      const serverIndex = merged.findIndex(s => s.id === localAssignment.id);
      
      if (serverIndex !== -1) {
        const serverAssignment = merged[serverIndex];
        const localUpdatedAt = new Date(localAssignment.updatedAt || 0).getTime();
        const serverUpdatedAt = new Date(serverAssignment.updatedAt?.seconds ? 
          serverAssignment.updatedAt.seconds * 1000 : 
          serverAssignment.updatedAt || 0).getTime();
        
        // If local version is newer or has payment status changes, preserve those
        if (localUpdatedAt > serverUpdatedAt || 
            (localAssignment.paid !== undefined && localAssignment.paid !== serverAssignment.paid)) {
          
          console.log(`🔄 Preserving local changes for assignment ${localAssignment.id}:`, {
            localPaid: localAssignment.paid,
            serverPaid: serverAssignment.paid,
            localUpdated: new Date(localUpdatedAt).toLocaleString(),
            serverUpdated: new Date(serverUpdatedAt).toLocaleString()
          });
          
          // Merge, preferring local changes for critical fields
          merged[serverIndex] = {
            ...serverAssignment,
            ...localAssignment,
            // Preserve local payment status and other user-modified fields
            paid: localAssignment.paid !== undefined ? localAssignment.paid : serverAssignment.paid,
            updatedAt: Math.max(localUpdatedAt, serverUpdatedAt)
          };
        }
      }
    });
    
    return merged;
  }

  public async updateAssignment(assignmentId: string, updates: any): Promise<void> {
    // ALL writes go through applyOp - single source of truth
    const operation: Operation = {
      id: generateUUID(),
      type: 'update',
      collection: 'assignments',
      entityId: assignmentId,
      data: updates,
      metadata: {
        deviceId: this.deviceId,
        timestamp: Date.now(),
        version: this.incrementVectorClock(),
        vectorClock: Object.fromEntries(this.vectorClock),
        source: 'local'
      }
    };

    console.log('� Assignment update via applyOp:', {
      assignmentId,
      updates,
      paid: updates.paid,
      operationId: operation.id
    });

    await this.applyOp(operation);
  }

  public async updateMultipleAssignments(userName: string, updates: any): Promise<void> {
    try {
      const assignments = await this.getAssignments();
      // Handle both old format (user), new format (playerName), and Firebase format (userName)
      const userAssignments = assignments.filter((a: any) => {
        const assignmentUser = a.playerName || a.userName || a.user; // Try all formats
        return assignmentUser === userName && !a.paid;
      });
      
      for (const assignment of userAssignments) {
        await this.updateAssignment(assignment.id, updates);
      }
    } catch (error) {
      console.error('Error updating multiple assignments:', error);
      throw error;
    }
  }

  public async deleteAssignment(assignmentId: string): Promise<void> {
    try {
      // Offline-first: Remove from local storage immediately
      const localAssignments = await this.getLocalAssignments();
      const updatedAssignments = localAssignments.filter(a => a.id !== assignmentId);
      await AsyncStorage.setItem('assignments', JSON.stringify(updatedAssignments));

      // If online, delete from Firebase
      if (this.isOnline) {
        try {
          await firebaseService.deleteAssignment(assignmentId);
          console.log('✅ Assignment deleted from Firebase:', assignmentId);
        } catch (error) {
          console.warn('⚠️ Failed to delete from Firebase, will sync when online:', error);
          // Add to sync queue for later
          this.addToSyncQueue({
            id: assignmentId,
            action: 'delete',
            collection: 'assignments',
            data: { id: assignmentId, deleted: true }
          });
        }
      } else {
        // Add to sync queue for when we come back online
        this.addToSyncQueue({
          id: assignmentId,
          action: 'delete',
          collection: 'assignments',
          data: { id: assignmentId, deleted: true }
        });
      }

      console.log('✅ Assignment deleted (offline-first):', assignmentId);
    } catch (error) {
      console.error('Error deleting assignment:', error);
      throw error;
    }
  }

  // ============================================
  // PUBLIC PRODUCT MANAGEMENT METHODS
  // ============================================

  public async getProducts(): Promise<any[]> {
    console.log('📦 Reading products from local cache (single source of truth)');
    
    try {
      // ALWAYS read from the unified offline-first cache first
      const localProducts = await this.getLocalData('products');
      
      // If we have local data, return it immediately (offline-first principle)
      if (localProducts && localProducts.length > 0) {
        console.log(`✅ Returning local products: ${localProducts.length}`);
        
        // Background sync if online (don't wait)
        if (this.isOnline) {
          console.log('🔄 Background: Hydrating products from server');
          this.hydrateProductsFromServer().catch((error: any) => {
            console.warn('Background product sync failed:', error);
          });
        }
        
        return localProducts;
      }
      
      // No local data - try initial sync if online
      if (this.isOnline) {
        console.log('📦 First-time access or stale cache - doing initial products sync');
        return await this.doInitialProductsSync();
      }
      
      // Offline with no cache - return empty array
      console.log('⚠️ Offline with no cached products');
      return [];
      
    } catch (error) {
      console.error('❌ Error getting products:', error);
      return [];
    }
  }



  // ============================================
  // SYNC STATUS & MONITORING
  // ============================================



  public async forceSyncNow(): Promise<void> {
    console.log('🚀 Manual sync triggered');
    if (!this.isOnline) {
      throw new Error('Cannot sync while offline');
    }
    
    // Reset all timestamps to allow immediate retry
    this.syncQueue.forEach(item => {
      item.timestamp = Date.now();
    });
    
    await this.saveSyncQueue();
    return this.processSyncQueue();
  }

  // ============================================
  // CACHE INITIALIZATION HELPERS
  // ============================================

  /**
   * Check if this is first-time access or cache needs refresh
   */
  private async isFirstTimeOrStaleCache(collection: string): Promise<boolean> {
    try {
      const cacheKey = `cache_initialized_${collection}_${this.getCurrentUserKey()}`;
      const initialized = await AsyncStorage.getItem(cacheKey);
      const lastSync = await AsyncStorage.getItem(`last_sync_${collection}`);
      
      // Not initialized OR last sync was more than 1 hour ago
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const isStale = lastSync ? parseInt(lastSync) < oneHourAgo : true;
      
      return !initialized || isStale;
    } catch (error) {
      console.warn('Cache initialization check failed:', error);
      return true; // Assume first-time if check fails
    }
  }

  /**
   * Mark cache as initialized for current user/organization
   */
  private async markCacheInitialized(collection: string): Promise<void> {
    try {
      const cacheKey = `cache_initialized_${collection}_${this.getCurrentUserKey()}`;
      const syncKey = `last_sync_${collection}`;
      
      await AsyncStorage.setItem(cacheKey, 'true');
      await AsyncStorage.setItem(syncKey, Date.now().toString());
    } catch (error) {
      console.warn('Failed to mark cache as initialized:', error);
    }
  }

  /**
   * Get unique key for current user/organization combination
   * Critical for multi-device scenarios with same account
   */
  private getCurrentUserKey(): string {
    // TODO: Replace with actual user authentication context
    // Should be: `${userId}_${organizationId}` for proper isolation
    // For now using device ID, but this needs user context from auth system
    return this.deviceId;
  }

  /**
   * Handle distributed user scenario - same account on multiple devices
   * This is where vector clocks become critical for conflict resolution
   */
  public async handleDistributedUserConflicts(): Promise<void> {
    console.log('⚡ Checking for distributed user conflicts (same account, different devices)');
    
    if (!this.isOnline) {
      console.log('📱 Offline - conflicts will be resolved when back online');
      return;
    }
    
    try {
      // Get latest server state for comparison
      const fbService = firebaseService;
      const [serverPlayers, serverAssignments] = await Promise.all([
        fbService.getPlayers(),
        fbService.getAssignments()
      ]);
      
      // Check for conflicts using vector clocks and timestamps
      await this.detectAndResolveConflicts('players', serverPlayers);
      await this.detectAndResolveConflicts('assignments', serverAssignments);
      
      console.log('✅ Distributed conflict resolution completed');
    } catch (error) {
      console.warn('⚠️ Distributed conflict resolution failed:', error);
    }
  }

  /**
   * Detect and resolve conflicts between local and server data
   */
  private async detectAndResolveConflicts(collection: string, serverData: any[]): Promise<void> {
    const localData = await this.getLocalData(collection);
    
    for (const serverItem of serverData) {
      const localItem = localData.find(item => item.id === serverItem.id);
      
      if (localItem && this.hasConflict(localItem, serverItem)) {
        console.log(`🔄 Resolving conflict for ${collection}:${serverItem.id}`);
        
        // Apply server update through applyOp for consistent handling
        await this.applyOp({
          id: generateUUID(),
          type: 'update',
          collection: collection as any,
          entityId: serverItem.id,
          data: serverItem,
          metadata: {
            deviceId: 'server',
            timestamp: Date.now(),
            version: serverItem.version || 1,
            vectorClock: serverItem.vectorClock || {},
            source: 'server'
          }
        });
      }
    }
  }

  /**
   * Check if there's a conflict between local and server versions
   */
  private hasConflict(localItem: any, serverItem: any): boolean {
    // Simple timestamp-based conflict detection
    // In production, would use vector clocks for proper causal ordering
    const localTimestamp = localItem.updatedAt || 0;
    const serverTimestamp = serverItem.updatedAt || 0;
    
    return Math.abs(localTimestamp - serverTimestamp) > 1000; // 1 second tolerance
  }

  /**
   * SAFELY clear cached data only after ensuring all data is synced to server
   * This prevents data loss during user switches or logouts
   */
  public async safelyLogoutUser(): Promise<void> {
    console.log('🔐 Starting safe user logout process');
    
    try {
      // Step 1: Force sync all pending operations
      if (this.syncQueue.length > 0) {
        console.log(`📤 Syncing ${this.syncQueue.length} pending operations before logout`);
        await this.forceSyncNow();
        
        // Wait a bit more to ensure sync completed
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if sync queue is now empty
        if (this.syncQueue.length > 0) {
          throw new Error(`Cannot logout safely - ${this.syncQueue.length} operations still pending sync`);
        }
      }
      
      // Step 2: Do final server sync to ensure everything is persisted
      if (this.isOnline) {
        console.log('🔄 Final verification sync before logout');
        await this.verifyAllDataSynced();
      } else {
        throw new Error('Cannot logout safely while offline - pending changes may be lost');
      }
      
      // Step 3: Only now is it safe to clear cache
      await this.clearCacheAfterSync();
      
      console.log('✅ Safe logout completed - all data preserved');
    } catch (error) {
      console.error('❌ Safe logout failed:', error);
      throw new Error(`Logout blocked to prevent data loss: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Internal method to clear cache only after sync verification
   */
  private async clearCacheAfterSync(): Promise<void> {
    const collections = ['players', 'assignments', 'products', 'staff-users', 'reports', 'charges', 'organizations'];
    const currentUserKey = this.getCurrentUserKey();
    
    // Clear all collection data (using actual storage keys, not _data suffix)
    for (const collection of collections) {
      await AsyncStorage.removeItem(collection); // Remove actual data
      await AsyncStorage.removeItem(`cache_initialized_${collection}_${currentUserKey}`);
      await AsyncStorage.removeItem(`last_sync_${collection}`);
    }
    
    // Clear organization-specific data that might be cached separately
    await AsyncStorage.removeItem('@organization_data'); // Clear organization context cache
    
    // Clear any organization-specific cached data (e.g., staff-users_<orgId>)
    // Get all AsyncStorage keys and remove any that are organization-specific
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const orgSpecificKeys = allKeys.filter(key => 
        key.includes('staff-users_') ||
        key.includes('organization_') ||
        key.includes('charges_') ||
        key.startsWith('@org_')
      );
      
      if (orgSpecificKeys.length > 0) {
        console.log('🧹 Clearing organization-specific keys:', orgSpecificKeys);
        await AsyncStorage.multiRemove(orgSpecificKeys);
      }
    } catch (error) {
      console.warn('Failed to clear organization-specific keys:', error);
    }
    
    // Clear sync queue and processed IDs
    await AsyncStorage.removeItem('syncQueue');
    this.syncQueue = [];
    this.processedIds.clear();
  }

  /**
   * Verify all local changes have been persisted to server
   */
  private async verifyAllDataSynced(): Promise<void> {
    // This would ideally check server timestamps vs local timestamps
    // For now, we ensure sync queue is empty and do a final push
    if (this.syncQueue.length > 0) {
      throw new Error('Sync queue not empty');
    }
    
    // Could add additional verification by comparing local vs server data
    console.log('✅ All data verified as synced to server');
  }

  /**
   * EMERGENCY logout - clears cache even with unsaved changes
   * ⚠️ WARNING: This WILL cause data loss if there are pending changes
   * Only use when user explicitly accepts data loss risk
   */
  public async emergencyLogout(userConfirmsDataLoss: boolean = false): Promise<void> {
    if (!userConfirmsDataLoss) {
      throw new Error('Emergency logout requires explicit user confirmation of data loss risk');
    }

    console.warn('🚨 EMERGENCY LOGOUT - Data loss may occur!');
    console.warn(`⚠️ Losing ${this.syncQueue.length} pending operations`);
    
    // Clear everything regardless of sync status
    await this.clearCacheAfterSync();
    
    console.warn('🚨 Emergency logout completed - some data may have been lost');
  }

  // ============================================
  // PLAYER OPERATIONS
  // ============================================

  public async getPlayers(): Promise<any[]> {
    console.log('📦 Reading players from local cache (single source of truth)');
    
    try {
      // ALWAYS read from the unified offline-first cache first
      const localPlayers = await this.getLocalData('players');
      
      // If we have local data, return it immediately (offline-first principle)
      if (localPlayers && localPlayers.length > 0) {
        console.log(`✅ Returning cached players: ${localPlayers.length}`);
        
        // Background sync if online (don't wait)
        if (this.isOnline) {
          console.log('� Background: Hydrating players from server');
          this.hydratePlayersFromServer().catch((error: any) => {
            console.warn('Background player sync failed:', error);
          });
        }
        
        return localPlayers;
      }
      
      // No local data - try initial sync if online
      if (this.isOnline) {
        console.log('📦 First-time access or empty cache - doing initial players sync');
        return await this.doInitialPlayersSync();
      }
      
      // Offline with no cache - return empty array
      console.log('⚠️ Offline with no cached players');
      return [];
      
    } catch (error) {
      console.error('❌ Error getting players:', error);
      return [];
    }
  }

  /**
   * Background hydration from server - applies server updates via applyOp
   */
  public async hydratePlayersFromServer(): Promise<void> {
    try {
      // Skip sync if no organization is set yet (e.g., during email verification)
      if (!firebaseService.isReady()) {
        console.log('⏭️ Skipping players hydration - no organization set yet');
        return;
      }
      
      console.log('🔄 Background: Hydrating players from server');
      const serverPlayers = await firebaseService.getPlayers();
      
      // Get current local players once for efficiency
      const localPlayers = await this.getLocalData('players');
      const localPlayerIds = new Set(localPlayers.map(p => p.id));

      // Apply each server update via applyOp for consistency
      for (const serverPlayer of serverPlayers) {
        // Properly handle Firebase Timestamp objects (same logic as assignments)
        let timestamp: number;
        try {
          console.log('🔍 Debug: serverPlayer.updatedAt:', serverPlayer.updatedAt, 'type:', typeof serverPlayer.updatedAt);
          
          if (serverPlayer.updatedAt?.seconds) {
            // Firebase Timestamp object - convert seconds to milliseconds
            timestamp = serverPlayer.updatedAt.seconds * 1000;
            // Add nanoseconds if available
            if (serverPlayer.updatedAt.nanoseconds) {
              timestamp += Math.floor(serverPlayer.updatedAt.nanoseconds / 1000000);
            }
            console.log('🔍 Converted Firebase Timestamp:', timestamp);
          } else if (serverPlayer.updatedAt?.toDate) {
            // Firebase Timestamp with toDate method
            timestamp = serverPlayer.updatedAt.toDate().getTime();
            console.log('🔍 Converted via toDate():', timestamp);
          } else if (typeof serverPlayer.updatedAt === 'string') {
            // ISO string - validate and convert to milliseconds
            const dateTest = new Date(serverPlayer.updatedAt);
            if (isNaN(dateTest.getTime())) {
              throw new Error(`Invalid ISO string: ${serverPlayer.updatedAt}`);
            }
            timestamp = dateTest.getTime();
            console.log('🔍 Converted ISO string:', serverPlayer.updatedAt, '→', timestamp);
          } else if (typeof serverPlayer.updatedAt === 'number') {
            // Already milliseconds
            timestamp = serverPlayer.updatedAt;
            console.log('🔍 Already number:', timestamp);
          } else {
            // Fallback to current time
            timestamp = Date.now();
            console.warn('⚠️ Could not parse updatedAt timestamp, using current time:', serverPlayer.updatedAt);
          }
          
          // Validate timestamp is reasonable (not too far in future or past)
          const now = Date.now();
          const oneYearMs = 365 * 24 * 60 * 60 * 1000;
          if (timestamp < now - oneYearMs || timestamp > now + oneYearMs) {
            console.warn('⚠️ Timestamp seems unreasonable, using current time:', new Date(timestamp));
            timestamp = now;
          }
          
        } catch (error) {
          console.warn('⚠️ Error processing timestamp, using current time:', error, 'Original:', serverPlayer.updatedAt);
          timestamp = Date.now();
        }

        // Determine if this is a new player or an update
        const isNewPlayer = !localPlayerIds.has(serverPlayer.id);
        const operationType = isNewPlayer ? 'create' : 'update';

        console.log(`👤 Server player sync: ${operationType} - ${serverPlayer.firstName} ${serverPlayer.lastName} (${serverPlayer.id})`);

        const operation: Operation = {
          id: generateUUID(),
          type: operationType,
          collection: 'players', // Players stored in players collection
          entityId: serverPlayer.id,
          data: serverPlayer,
          metadata: {
            deviceId: 'server',
            timestamp: timestamp,
            version: 0, // Server doesn't have vector clocks yet
            vectorClock: {},
            source: 'server'
          }
        };
        
        // Apply server updates via single write path
        await this.applyOp(operation);
      }
      
      // CRITICAL: Detect deletions by comparing local vs server data
      console.log('🔍 Checking for deleted players (server deletions)...');
      const serverPlayerIds = new Set(serverPlayers.map(p => p.id));
      const deletedPlayers = localPlayers.filter(localPlayer => !serverPlayerIds.has(localPlayer.id));
      
      for (const deletedPlayer of deletedPlayers) {
        console.log(`🗑️ Server deletion detected: Player "${deletedPlayer.firstName} ${deletedPlayer.lastName}" (${deletedPlayer.id}) no longer exists on server`);
        
        const deleteOperation: Operation = {
          id: generateUUID(),
          type: 'delete',
          collection: 'players',
          entityId: deletedPlayer.id,
          data: {},
          metadata: {
            deviceId: 'server',
            timestamp: Date.now(),
            version: 0,
            vectorClock: {},
            source: 'server'
          }
        };
        
        await this.applyOp(deleteOperation);
      }
      
      if (deletedPlayers.length > 0) {
        console.log(`✅ Processed ${deletedPlayers.length} server deletions for players`);
      }

      console.log('✅ Server hydration completed via applyOp');
      
    } catch (error) {
      console.error('❌ Server hydration failed:', error);
    }
  }

  /**
   * Background hydration of products from server (similar to players)
   */
  public async hydrateProductsFromServer(): Promise<void> {
    try {
      // Skip sync if no organization is set yet (e.g., during email verification)
      if (!firebaseService.isReady()) {
        console.log('⏭️ Skipping products hydration - no organization set yet');
        return;
      }
      
      console.log('📦 Syncing with server and merging with local changes');
      const serverProducts = await firebaseService.getProducts();
      
      if (!serverProducts || serverProducts.length === 0) {
        console.log('✅ Server product hydration completed via applyOp');
        return;
      }

      // Get current local products to determine create vs update
      const localProducts = await this.getLocalData('products');
      const localProductIds = new Set(localProducts.map(p => p.id));

      // Apply each server product via applyOp
      for (const serverProduct of serverProducts) {
        // Process timestamp (same logic as players)
        let timestamp: number;
        try {
          if (serverProduct.updatedAt?.seconds) {
            timestamp = serverProduct.updatedAt.seconds * 1000 + (serverProduct.updatedAt.nanoseconds || 0) / 1000000;
            console.log('🔍 Converted Firebase Timestamp:', timestamp);
          } else if (typeof serverProduct.updatedAt === 'string') {
            timestamp = new Date(serverProduct.updatedAt).getTime();
          } else if (typeof serverProduct.updatedAt === 'number') {
            timestamp = serverProduct.updatedAt;
          } else {
            timestamp = Date.now();
            console.warn('⚠️ No valid updatedAt timestamp, using current time');
          }
        } catch (error) {
          console.warn('⚠️ Error processing product timestamp:', error);
          timestamp = Date.now();
        }

        // Determine if this is a new product or an update
        const isNewProduct = !localProductIds.has(serverProduct.id);
        const operationType = isNewProduct ? 'create' : 'update';

        console.log(`📦 Server product sync: ${operationType} - ${serverProduct.name} (${serverProduct.id})`);

        const operation: Operation = {
          id: generateUUID(),
          type: operationType,
          collection: 'products',
          entityId: serverProduct.id,
          data: serverProduct,
          metadata: {
            deviceId: 'server',
            timestamp: timestamp,
            version: 0,
            vectorClock: {},
            source: 'server'
          }
        };

        await this.applyOp(operation);
      }

      // CRITICAL: Detect deletions by comparing local vs server data
      console.log('🔍 Checking for deleted products (server deletions)...');
      const serverProductIds = new Set(serverProducts.map(p => p.id));
      const deletedProducts = localProducts.filter(localProduct => !serverProductIds.has(localProduct.id));
      
      for (const deletedProduct of deletedProducts) {
        console.log(`🗑️ Server deletion detected: Product "${deletedProduct.name}" (${deletedProduct.id}) no longer exists on server`);
        
        const deleteOperation: Operation = {
          id: generateUUID(),
          type: 'delete',
          collection: 'products',
          entityId: deletedProduct.id,
          data: {},
          metadata: {
            deviceId: 'server',
            timestamp: Date.now(), // Current time since we're detecting deletion now
            version: 0,
            vectorClock: {},
            source: 'server'
          }
        };
        
        await this.applyOp(deleteOperation);
      }
      
      if (deletedProducts.length > 0) {
        console.log(`✅ Processed ${deletedProducts.length} server deletions for products`);
      }

      console.log('✅ Server product hydration completed via applyOp');
    } catch (error) {
      console.error('❌ Product server hydration failed:', error);
    }
  }

  /**
   * Initial products sync for first-time access
   */
  private async doInitialProductsSync(): Promise<any[]> {
    try {
      // Skip initial sync if no organization is set yet
      if (!firebaseService.isReady()) {
        console.log('⏭️ Skipping initial products sync - no organization set yet');
        return [];
      }
      
      console.log('📦 First-time access or stale cache - doing initial products sync');
      const serverProducts = await firebaseService.getProducts();
      
      // Save to local cache using proper offline-first system
      await this.saveLocalData('products', serverProducts || []);
      console.log(`✅ Initial products sync completed: ${(serverProducts || []).length}`);
      
      // Start background hydration via applyOp
      if (serverProducts && serverProducts.length > 0) {
        console.log('🔄 Background: Hydrating products from server');
        this.hydrateProductsFromServer().catch((error: any) => {
          console.warn('Background product hydration failed:', error);
        });
      }
      
      return serverProducts || [];
    } catch (error) {
      console.error('❌ Initial products sync failed:', error);
      return [];
    }
  }

  private async doInitialPlayersSync(): Promise<any[]> {
    try {
      // Skip initial sync if no organization is set yet
      if (!firebaseService.isReady()) {
        console.log('⏭️ Skipping initial players sync - no organization set yet');
        return [];
      }
      
      console.log('📦 First-time access or empty cache - doing initial players sync');
      const fbService = firebaseService;
      const serverPlayers = await fbService.getPlayers();
      
      // Save to local cache using proper offline-first system
      await this.saveLocalData('players', serverPlayers || []);
      console.log(`✅ Initial players sync completed: ${(serverPlayers || []).length}`);
      
      // Mark cache as initialized to prevent future first-time loads
      await this.markCacheInitialized('players');
      
      // Start background hydration via applyOp
      if (serverPlayers && serverPlayers.length > 0) {
        console.log('🔄 Background: Hydrating players from server');
        this.hydratePlayersFromServer().catch((error: any) => {
          console.warn('Background player hydration failed:', error);
        });
      }
      
      return serverPlayers || [];
    } catch (error) {
      console.error('❌ Initial players sync failed:', error);
      return [];
    }
  }



  /**
   * Hydrate all data from server during app startup
   * This applies server changes via applyOp with proper vector clock resolution
   * Used to ensure users see changes made by others while they were offline
   */
  public async hydrateFromServerForStartup(): Promise<void> {
    try {
      console.log('🔄 STARTUP HYDRATION: Applying latest server changes via applyOp');
      
      // Hydrate all data types from server - these use applyOp and vector clocks
      await Promise.all([
        this.hydratePlayersFromServer(),
        this.hydrateProductsFromServer(), 
        this.hydrateAssignmentsFromServer()
        // TODO: Add hydrateChargesFromServer and hydrateOrganizationsFromServer
        // For now, these are loaded on-demand via getChargesWithOverlay and getOrganizationWithOverlay
      ]);
      
      console.log('✅ STARTUP HYDRATION: All server changes applied via applyOp');
    } catch (error) {
      console.error('❌ STARTUP HYDRATION: Failed to hydrate from server:', error);
      // Don't throw - this is non-fatal for app startup
    }
  }

  private async getLocalPlayers(): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem('players'); // Players stored in players collection
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('❌ Error getting local players:', error);
      return [];
    }
  }

  public async updatePlayerBalance(playerId: string, amount: number, isDebit: boolean): Promise<void> {
    // ALL writes go through applyOp - single source of truth
    const operation: Operation = {
      id: generateUUID(),
      type: 'updateBalance',
      collection: 'players', // Players stored in players collection
      entityId: playerId,
      data: { amount, isDebit },
      metadata: {
        deviceId: this.deviceId,
        timestamp: Date.now(),
        version: this.incrementVectorClock(),
        vectorClock: Object.fromEntries(this.vectorClock),
        source: 'local'
      }
    };

    console.log('� Player balance update via applyOp:', {
      playerId,
      amount,
      isDebit,
      operationId: operation.id
    });

    await this.applyOp(operation);
  }

  private async updateLocalPlayerBalance(playerId: string, amount: number, isDebit: boolean): Promise<void> {
    try {
      const players = await this.getLocalPlayers();
      const timestamp = Date.now();
      const updatedPlayers = this.updatePlayerInArray(players, playerId, amount, isDebit, timestamp);
      await AsyncStorage.setItem('players', JSON.stringify(updatedPlayers)); // Players stored in players collection
      
      console.log('💾 Updated local player balance with timestamp:', {
        playerId,
        amount,
        isDebit,
        timestamp: new Date(timestamp).toISOString()
      });
    } catch (error) {
      console.error('❌ Error updating local player balance:', error);
      throw error;
    }
  }

  /**
   * Pure function to update player balance in array with proper timestamps
   */
  private updatePlayerInArray(players: any[], playerId: string, amount: number, isDebit: boolean, timestamp: number): any[] {
    const playerIndex = players.findIndex(p => p.id === playerId);
    
    if (playerIndex === -1) {
      console.error('❌ Player not found in array:', playerId);
      return players;
    }

    const updatedPlayers = [...players];
    const player = { ...updatedPlayers[playerIndex] };
    
    // Update balance
    const currentBalance = player.balance || 0;
    player.balance = isDebit ? 
      currentBalance + amount : 
      Math.max(0, currentBalance - amount);
    
    // Update tracking fields
    if (isDebit) {
      player.totalSpent = (player.totalSpent || 0) + amount;
      player.totalPurchases = (player.totalPurchases || 0) + 1;
    }
    
    // Set timestamp and vector clock for conflict resolution
    player.updatedAt = timestamp;
    player.version = this.createVersionVector();
    
    updatedPlayers[playerIndex] = player;
    
    console.log('🔄 Player updated in array:', {
      playerId,
      newBalance: player.balance,
      updatedAt: new Date(timestamp).toISOString(),
      isDebit,
      amount
    });
    
    return updatedPlayers;
  }

  /**
   * Merge local and server players with timestamp-based conflict resolution
   */
  private mergePlayers(localPlayers: any[], serverPlayers: any[]): any[] {
    console.log('🔀 Starting players merge:', {
      localCount: localPlayers.length,
      serverCount: serverPlayers.length
    });

    // Start with server players as base
    const merged = [...serverPlayers];
    
    // Merge local changes
    localPlayers.forEach(localPlayer => {
      const serverIndex = merged.findIndex(p => p.id === localPlayer.id);
      
      if (serverIndex !== -1) {
        const serverPlayer = merged[serverIndex];
        const localUpdatedAt = new Date(localPlayer.updatedAt || 0).getTime();
        const serverUpdatedAt = new Date(serverPlayer.updatedAt?.seconds ? 
          serverPlayer.updatedAt.seconds * 1000 : 
          serverPlayer.updatedAt || 0).getTime();
        
        // Enhanced conflict resolution with vector clocks
        const shouldPreserveLocal = this.shouldPreserveLocalVersion(
          localPlayer, 
          serverPlayer, 
          localUpdatedAt, 
          serverUpdatedAt
        );
        
        if (shouldPreserveLocal) {
          
          console.log(`🔄 Preserving local changes for player ${localPlayer.id}:`, {
            localBalance: localPlayer.balance,
            serverBalance: serverPlayer.balance,
            localUpdated: new Date(localUpdatedAt).toLocaleString(),
            serverUpdated: new Date(serverUpdatedAt).toLocaleString()
          });
          
          // Merge, preferring local changes for critical fields
          merged[serverIndex] = {
            ...serverPlayer,
            ...localPlayer,
            // Preserve local balance and tracking data
            balance: localPlayer.balance !== undefined ? localPlayer.balance : serverPlayer.balance,
            totalSpent: localPlayer.totalSpent !== undefined ? localPlayer.totalSpent : serverPlayer.totalSpent,
            totalPurchases: localPlayer.totalPurchases !== undefined ? localPlayer.totalPurchases : serverPlayer.totalPurchases,
            updatedAt: localUpdatedAt > serverUpdatedAt ? localPlayer.updatedAt : serverPlayer.updatedAt
          };
        }
      } else {
        // Local player not found on server, add it (rare case)
        console.log(`➕ Adding local-only player to merge: ${localPlayer.id}`);
        merged.push(localPlayer);
      }
    });
    
    console.log('✅ Players merge completed:', {
      mergedCount: merged.length
    });
    
    return merged;
  }

  /**
   * Determine if local version should be preserved using vector clock analysis
   */
  private shouldPreserveLocalVersion(
    localEntity: any, 
    serverEntity: any, 
    localTimestamp: number, 
    serverTimestamp: number
  ): boolean {
    // Basic timestamp check
    if (localTimestamp > serverTimestamp) {
      console.log('🕐 Local version newer by timestamp');
      return true;
    }
    
    // Check for critical field changes (like balance for players)
    if (localEntity.balance !== undefined && localEntity.balance !== serverEntity.balance) {
      console.log('💰 Local balance differs from server');
      return true;
    }
    
    // Vector clock comparison (if available)
    if (localEntity.version && serverEntity.version) {
      const localVersion = localEntity.version;
      const serverVersion = serverEntity.version;
      
      // If from same device, use version number
      if (localVersion.deviceId === serverVersion.deviceId) {
        const result = localVersion.version > serverVersion.version;
        console.log('📱 Same device version comparison:', {
          local: localVersion.version,
          server: serverVersion.version,
          preserveLocal: result
        });
        return result;
      }
      
      // Different devices - check for concurrent updates
      const isConcurrent = this.isConcurrentUpdate(localVersion, serverVersion);
      if (isConcurrent) {
        console.log('⚡ Concurrent update detected - using timestamp fallback');
        return localTimestamp >= serverTimestamp; // Tie-breaker
      }
    }
    
    return false;
  }

  /**
   * Check if two versions represent concurrent updates
   */
  private isConcurrentUpdate(version1: any, version2: any): boolean {
    if (!version1.vectorClock || !version2.vectorClock) {
      return false;
    }
    
    // Two updates are concurrent if neither vector clock dominates the other
    let v1DominatesV2 = true;
    let v2DominatesV1 = true;
    
    const allDevices = new Set([
      ...Object.keys(version1.vectorClock),
      ...Object.keys(version2.vectorClock)
    ]);
    
    for (const deviceId of allDevices) {
      const v1Count = version1.vectorClock[deviceId] || 0;
      const v2Count = version2.vectorClock[deviceId] || 0;
      
      if (v1Count < v2Count) v1DominatesV2 = false;
      if (v2Count < v1Count) v2DominatesV1 = false;
    }
    
    // Concurrent if neither dominates
    return !v1DominatesV2 && !v2DominatesV1;
  }

  // ============================================
  // OUTBOX MANAGEMENT HELPERS
  // ============================================

  /**
   * Check if queue contains high priority items (payments, assignments, organization settings)
   */
  private hasHighPriorityItems(): boolean {
    return this.syncQueue.some(item => 
      (item.collection === 'assignments' && (item.data.paid !== undefined || item.action === 'updateBalance')) ||
      item.collection === 'players' && item.action === 'updateBalance' || // Players stored in players collection
      item.collection === 'organizations' // Organization settings are high priority
    );
  }

  /**
   * Clean up processed IDs to prevent memory bloat
   */
  private cleanupProcessedIds(): void {
    // Keep only recent processed IDs (last hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    // Note: In a production system, you'd want to store timestamps with processed IDs
    // For now, we'll just limit the size
    if (this.processedIds.size > 1000) {
      // Convert to array, keep newest 500
      const idsArray = Array.from(this.processedIds);
      this.processedIds.clear();
      
      // Keep the last 500 IDs
      idsArray.slice(-500).forEach(id => this.processedIds.add(id));
      
      console.log('🧹 Cleaned up processed IDs cache, kept 500 most recent');
    }
  }

  /**
   * Process dead letter queue - retry items that might work now
   */
  private async processDeadLetterQueue(): Promise<void> {
    if (this.deadLetterQueue.length === 0) return;
    
    console.log(`💀 Processing dead letter queue: ${this.deadLetterQueue.length} items`);
    
    const itemsToRetry: SyncQueueItem[] = [];
    
    // Check which items might be worth retrying
    this.deadLetterQueue.forEach(item => {
      // Retry items older than 1 hour
      if (Date.now() - item.timestamp > 3600000) {
        // Reset retry count and add back to main queue
        item.retryCount = 0;
        item.timestamp = Date.now();
        itemsToRetry.push(item);
      }
    });
    
    if (itemsToRetry.length > 0) {
      // Move items back to main queue
      this.syncQueue.push(...itemsToRetry);
      
      // Remove from dead letter queue
      this.deadLetterQueue = this.deadLetterQueue.filter(item => 
        !itemsToRetry.some(retry => retry.id === item.id)
      );
      
      await this.saveSyncQueue();
      await this.saveDeadLetterQueue();
      
      console.log(`♻️ Moved ${itemsToRetry.length} items from dead letter queue back to main queue`);
    }
  }

  /**
   * Get comprehensive sync status with dead letter queue info
   */
  public getSyncStatus(): any {
    const baseStatus = {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      mainQueueLength: this.syncQueue.length,
      deadLetterQueueLength: this.deadLetterQueue.length,
      processedIdsCount: this.processedIds.size,
      hasHighPriority: this.hasHighPriorityItems()
    };

    if (this.syncQueue.length === 0) {
      return { ...baseStatus, status: 'idle' };
    }

    const currentTime = Date.now();
    const readyItems = this.syncQueue.filter(item => 
      item.timestamp <= currentTime && !this.processedIds.has(item.id)
    );
    const pendingItems = this.syncQueue.filter(item => 
      item.timestamp > currentTime
    );

    return {
      ...baseStatus,
      readyForSync: readyItems.length,
      pendingRetry: pendingItems.length,
      nextRetryIn: pendingItems.length > 0 ? 
        Math.max(0, Math.min(...pendingItems.map(item => item.timestamp)) - currentTime) : 0,
      averageRetryCount: this.syncQueue.length > 0 ? 
        this.syncQueue.reduce((sum, item) => sum + item.retryCount, 0) / this.syncQueue.length : 0
    };
  }

  // ============================================
  // PLAYER MANAGEMENT METHODS
  // ============================================

  /**
   * Add a new player to the players collection
   */
  async addPlayer(player: Omit<any, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    console.log('🎯 ADD PLAYER - Starting process:', {
      inputPlayer: player,
      isOnline: this.isOnline,
      timestamp: new Date().toISOString()
    });
    
    const playerId = generateUUID();
    const playerData = {
      ...player,
      id: playerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    console.log('🎯 ADD PLAYER - Generated player data:', {
      playerId,
      playerData,
      willSyncToFirebase: this.isOnline
    });
    
    // Use applyOp for consistent data handling
    const operation: Operation = {
      id: generateUUID(),
      type: 'create',
      collection: 'players',
      entityId: playerId,
      data: playerData,
      metadata: {
        deviceId: this.deviceId,
        timestamp: Date.now(),
        version: this.incrementVectorClock(),
        vectorClock: Object.fromEntries(this.vectorClock),
        source: 'local'
      }
    };

    console.log('🎯 ADD PLAYER - Created operation:', {
      operationId: operation.id,
      operationType: operation.type,
      operationCollection: operation.collection,
      operationEntityId: operation.entityId,
      operationTimestamp: operation.metadata.timestamp,
      operationSource: operation.metadata.source
    });

    console.log('🎯 ADD PLAYER - Calling applyOp...');
    await this.applyOp(operation);
    console.log('✅ ADD PLAYER - applyOp completed, player created with ID:', playerId);
    
    return playerId;
  }

  /**
   * Update a player using the unified updateEntity method
   */
  async updatePlayer(id: string, updates: Partial<any>): Promise<void> {
    console.log('🎯 HybridSyncService: Updating player:', id, updates);
    return this.updateEntity('players', id, updates);
  }

  /**
   * Delete a player by setting isActive to false
   */
  async deletePlayer(playerId: string): Promise<void> {
    console.log('🎯 HybridSyncService: Soft deleting player:', playerId);
    return this.updatePlayer(playerId, { isActive: false });
  }

  /**
   * Simple players getter - works like getProducts() for reliable offline caching
   * Use this instead of the complex getPlayers() method
   */
  public async getPlayersSimple(): Promise<any[]> {
    try {
      if (this.isOnline) {
        // Try to get from Firebase first (like products)
        console.log('🌐 Online: Fetching players from Firebase (simple method)');
        if (!firebaseService.isReady()) {
          throw new Error('FirebaseService is not ready. Organization ID not set.');
        }
        const firebasePlayers = await firebaseService.getPlayers();
        // Update local storage
        await AsyncStorage.setItem('players', JSON.stringify(firebasePlayers));
        console.log('✅ Players cached to local storage:', firebasePlayers.length);
        return firebasePlayers;
      } else {
        // Return from local storage when offline
        console.log('📱 Offline: Loading players from local cache (simple method)');
        return await this.getLocalPlayers();
      }
    } catch (error) {
      console.error('❌ Error getting players (simple method):', error);
      // Always fallback to local cache on error
      return await this.getLocalPlayers();
    }
  }

  /**
   * Merge server players with local players that haven't synced yet
   */
  private async mergeServerWithLocalPlayers(serverPlayers: any[], localPlayers: any[]): Promise<any[]> {
    console.log('🔄 Merging server players with local changes');
    
    // Create a map of server players by ID for fast lookup
    const serverPlayerMap = new Map();
    serverPlayers.forEach(player => {
      if (player.id) {
        serverPlayerMap.set(player.id, player);
      }
    });
    
    // Start with all server players
    const merged = [...serverPlayers];
    
    // Add local players that aren't in the server data (local-only additions)
    const localOnlyPlayers = localPlayers.filter(localPlayer => {
      // Skip if no ID
      if (!localPlayer.id) return false;
      
      // Include if not in server data (local-only player)
      return !serverPlayerMap.has(localPlayer.id);
    });
    
    // Add local-only players to the merged result
    merged.push(...localOnlyPlayers);
    
    console.log('🔄 Merge result:', {
      server: serverPlayers.length,
      localOnly: localOnlyPlayers.length,
      total: merged.length,
      localOnlyIds: localOnlyPlayers.map(p => p.id)
    });
    
    return merged;
  }

  /**
   * Sync all player balances based on their purchase history
   */
  async syncAllPlayerBalances(): Promise<void> {
    console.log('🎯 HybridSyncService: Syncing all player balances');
    try {
      // Use the global firebaseService instance that has the organization ID set
      if (!firebaseService.isReady()) {
        throw new Error('FirebaseService is not ready. Organization ID not set.');
      }
      await firebaseService.syncAllPlayerBalances();
      
      // Trigger sync to refresh local data
      await this.forceSyncNow();
      
      console.log('✅ All player balances synchronized');
    } catch (error) {
      console.error('❌ Error syncing player balances:', error);
      throw error;
    }
  }

  /**
   * Fix player name consistency across sales records
   */
  async fixPlayerNameConsistency(): Promise<void> {
    console.log('🎯 HybridSyncService: Fixing player name consistency');
    try {
      // Use the global firebaseService instance that has the organization ID set
      if (!firebaseService.isReady()) {
        throw new Error('FirebaseService is not ready. Organization ID not set.');
      }
      await firebaseService.fixPlayerNameConsistency();
      
      // Trigger sync to refresh local data
      await this.forceSyncNow();
      
      console.log('✅ Player name consistency fixed');
    } catch (error) {
      console.error('❌ Error fixing player name consistency:', error);
      throw error;
    }
  }



  /**
   * Preload all critical data for offline availability
   * Call this during initial login to ensure data is cached
   */
  async preloadCriticalData(): Promise<void> {
    if (!this.isOnline) {
      console.log('⚠️ Offline - skipping preload, will use cached data');
      return;
    }

    console.log('🚀 Preloading critical data for offline availability...');
    
    try {
      // Preload all critical collections in parallel
      const preloadPromises = [
        this.getPlayers(),    // Load and cache players
        this.getProducts(),   // Load and cache products  
        this.getAssignments() // Load and cache assignments
      ];
      
      const [players, products, assignments] = await Promise.all(preloadPromises);
      
      console.log('✅ Critical data preloaded successfully:', {
        players: players.length,
        products: products.length, 
        assignments: assignments.length
      });
      
      // Update last sync timestamps for all collections
      const timestamp = Date.now().toString();
      await AsyncStorage.setItem('last_sync_players', timestamp);
      await AsyncStorage.setItem('last_sync_products', timestamp);
      await AsyncStorage.setItem('last_sync_assignments', timestamp);
      
    } catch (error) {
      console.error('❌ Error preloading critical data:', error);
      // Don't throw - partial preload is better than no preload
    }
  }

  // ============================================
  // DEBUG UTILITIES
  // ============================================
  
  /**
   * Debug current sync state - useful for troubleshooting
   */
  async debugSyncState(): Promise<void> {
    console.log('🔍 =============== SYNC STATE DEBUG ===============');
    
    try {
      // Check players in local storage
      const playersStr = await AsyncStorage.getItem('players');
      const players = playersStr ? JSON.parse(playersStr) : [];
      console.log('🔍 Local Storage Players:', {
        count: players.length,
        players: players.map((p: any) => ({
          id: p.id,
          name: p.name || `${p.firstName} ${p.lastName}`,
          createdAt: p.createdAt,
          hasAllFields: !!(p.firstName && p.lastName && p.id)
        }))
      });
      
      // Check sync queue
      console.log('🔍 Current Sync Queue:', {
        length: this.syncQueue.length,
        items: this.syncQueue.map(item => ({
          id: item.id,
          collection: item.collection,
          action: item.action,
          timestamp: new Date(item.timestamp).toLocaleString(),
          retryCount: item.retryCount,
          entityId: item.data?.entityId || item.data?.id,
          hasData: !!item.data
        }))
      });
      
      // Check network state
      console.log('🔍 Network State:', {
        isOnline: this.isOnline,
        queueLength: this.getSyncQueueLength()
      });
      
      // Check for any player operations specifically
      const playerOps = this.syncQueue.filter(item => item.collection === 'players');
      console.log('🔍 Player Operations in Queue:', {
        count: playerOps.length,
        operations: playerOps
      });
      
      console.log('🔍 ============================================');
      
    } catch (error) {
      console.error('❌ Error debugging sync state:', error);
    }
  }

  /**
   * Manual sync trigger for debugging
   */
  async debugForceSyncNow(): Promise<void> {
    console.log('🔧 DEBUG: Forcing manual sync...');
    
    if (!this.isOnline) {
      console.log('❌ Cannot sync - currently offline');
      return;
    }
    
    if (this.syncQueue.length === 0) {
      console.log('ℹ️ Nothing to sync - queue is empty');
      return;
    }
    
    console.log(`🚀 Attempting to sync ${this.syncQueue.length} items...`);
    await this.drainOutboxWithTransaction();
    console.log('✅ Manual sync attempt completed');
  }

  // CLEANUP
  // ============================================

  public destroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    if (this.highPriorityInterval) {
      clearInterval(this.highPriorityInterval);
    }
    if (this.conflictDetectionInterval) {
      clearInterval(this.conflictDetectionInterval);
    }
    if (this.deadLetterInterval) {
      clearInterval(this.deadLetterInterval);
    }
    if (this.stuckSyncInterval) {
      clearInterval(this.stuckSyncInterval);
    }
    if (this.serverChangesInterval) {
      clearInterval(this.serverChangesInterval);
    }
  }

  /**
   * Debug method to process a single sync queue item
   * Used by debug panel to test individual item processing
   */
  public async debugProcessSingleItem(item: SyncQueueItem): Promise<void> {
    console.log('🐛 Debug processing single item:', item);
    
    if (!this.isOnline) {
      throw new Error('Cannot process item - device is offline');
    }

    try {
      // Process as a single-item batch
      await this.processBatchTransaction([item]);
      console.log('✅ Debug processing succeeded for item:', item.id);
    } catch (error) {
      console.error('❌ Debug processing failed for item:', item.id, error);
      throw error;
    }
  }

  /**
   * Get detailed sync status for debugging
   */
  public getDetailedSyncStatus(): any {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      mainQueueLength: this.syncQueue.length,
      deadLetterQueueLength: this.deadLetterQueue.length,
      processedIdsCount: this.processedIds?.size || 0,
      status: this.syncQueue.length === 0 ? 'idle' : 'pending',
      readyForSync: Date.now(),
      pendingRetry: this.syncQueue.filter(item => (item.retryCount || 0) > 0).length,
      averageRetryCount: this.syncQueue.length > 0 
        ? this.syncQueue.reduce((sum, item) => sum + (item.retryCount || 0), 0) / this.syncQueue.length 
        : 0
    };
  }
}

// Export singleton instance
export const hybridSyncService = new HybridSyncService();
