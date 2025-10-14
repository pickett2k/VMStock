// ops/BundleOp.ts
export type OpSource = 'local' | 'server' | 'sync';

export interface StepResultAck { opId: string; appliedAt: number; }

export interface BundleOp {
  bundleId: string;
  type: 'assignmentSale' | 'stockTake' | 'payment' | 'charge';
  entityRefs: { assignmentId?: string; productId?: string; playerId?: string; chargeId?: string };
  steps: Array<{
    opId: string;               // deterministic hash(bundleId, stepName)
    kind: 'createAssignment' | 'stockDelta' | 'balanceDelta' | 'markPaid' | 'stockTakeRebase' | 'createCharge';
    payload: Record<string, any>;
  }>;
  vectorClock: Record<string, number>;
  timestamp: number;
  source: OpSource;
}

export interface ProvisionalState {
  assignments: Map<string, any>;
  charges: Map<string, any>;
  productStock: Map<string, { productId: string; delta: number; opId: string }[]>;
  playerLedger: Map<string, { playerId: string; delta: number; opId: string }[]>;
}

export interface BundleContext {
  bundleId: string;
  entityRefs: { assignmentId?: string; productId?: string; playerId?: string };
  provisional: ProvisionalState;
}