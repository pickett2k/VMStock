# VMStock — Transactional Scenarios & Sync Rules (Architecture + Implementation)

> **Goal:** Make assignments (sales) safe offline, without losing stock accuracy or customer balances when devices reconnect — even with concurrent stock‑takes and online sales.

_Last updated: 08 Oct 2025_

---

## Contents
1. Problem Statement
2. Design Objectives
3. Architecture: Transactions, Bundles & Provisional State
4. Conflict Semantics by Entity (Players, Products, Assignments)
5. Stock‑take vs Sales: Safe Merge Strategy
6. Failure, Retries & Compensations (Sagas)
7. Read Reconciliation: Preventing Local Overwrites
8. Server (Firebase) Contract & Security Rules
9. Implementation Plan (TypeScript): drop‑in changes
10. Test Matrix (edge cases)
11. Rollout Strategy & Telemetry

---

## 1) Problem Statement

**Scenario A — Offline assignment (sale)** must atomically:
1) create `assignment`, 2) decrement `product.stock`, 3) update `player.balance`.

When the device comes online, a partial failure or naïve *server‑wins* merge can:
- overwrite local deltas, 
- double‑apply decrements, or 
- lose player balance updates.

**Scenario B — Concurrent updates**: User A performs **offline stock‑take** (absolute counts) while User B performs **online sales** (relative decrements). On reconnect, the absolute count can clobber the decrements or vice‑versa.

---

## 2) Design Objectives

- **Atomic bundles:** Treat multi‑entity write as one logical unit.
- **Idempotent & replayable:** Safe to retry on flappy networks.
- **Conflict‑aware:** Merge absolute counts (stock‑take) with relative deltas (sales).
- **No local data loss:** Server hydration must **overlay**, not overwrite.
- **Simple mental model:** All writes flow through `applyOp`/`createAssignmentTransaction`.

---

## 3) Architecture: Transactions, Bundles & Provisional State

### 3.1 BundleOp (client‑side saga)
Wrap related sub‑operations in one **`BundleOp`** persisted to the outbox.
Each sub‑op includes a deterministic `opId` for idempotency and an optional **compensation**.

```
BundleOp {
  bundleId: UUID,
  type: 'assignmentSale',
  entityRefs: { assignmentId, productId, playerId },
  steps: [
    { opId: hash(bundleId, 'createAssignment'),   do: CreateAssignment,   undo: DeleteAssignment },
    { opId: hash(bundleId, 'decrementStock'),     do: DecrementStock,     undo: IncrementStock },
    { opId: hash(bundleId, 'updatePlayerBalance'),do: AddDebitToBalance,  undo: AddCreditToBalance }
  ],
  vectorClock, timestamp, source
}
```

- **Local first:** Apply to local cache immediately as **provisional**.
- **Outbox:** Enqueue the `BundleOp` for sync. Batch/commit server‑side.
- **Idempotency:** Each step uses `opId`, so retries are no‑ops if already applied.

### 3.2 Provisional state overlays
Maintain a **`provisional` overlay** per collection:
- `localBase` = last confirmed state from server hydration.
- `provisionalDeltas[]` = unapplied or pending bundles.
- `read()` = `reduce(localBase ⊕ provisionalDeltas)`.
- On **server commit**, convert matching provisional deltas to **committed markers** and prune.

This guarantees UI never “snaps back” when server hydration arrives.

---

## 4) Conflict Semantics by Entity

| Entity | Canonical model | Merge rule | Notes |
|---|---|---|---|
| **Assignments** | Immutable event (created once) + mutable flags (`paid`) | **Create is idempotent** by `assignmentId`. Mutations use **LWW** on non‑critical fields; **paid** uses **max(timestamp)** (paid cannot revert to unpaid without explicit reversal op). | UI calls `createAssignmentTransaction` as one bundle. |
| **Products.stock** | On‑hand quantity | **Hybrid**: apply **relative deltas** (sales, ±q) as a **G‑Counter/PN‑Counter** stream; apply **absolute counts** (stock‑take) via **rebase** algorithm (see §5). | Avoid direct `= newStock` writes except via Stock‑Take op. |
| **Players.balance** | Running balance | **Ledger of signed deltas** (debits for charges, credits for payments). Materialized `balance = Σ(deltas)`. | Prevents double‑charge; never overwrite `balance` directly. |

**Why counters/ledger?** They are CRDT‑friendly and idempotent under retries.

---

## 5) Stock‑take vs Sales: Safe Merge Strategy

**Operations**
- `Sale(productId, q)` → relative **delta**: `onHand -= q`.
- `StockTake(productId, count, baseVector)` → **absolute** rebase against a known base.

**Rebase algorithm**
1. When a stock‑take starts, capture `baseSnapshot` and its `vectorClock` for the product.
2. Compute `intermediateDelta = Σ(sales since baseVector)` (from local ledger once hydrated, plus local provisional deltas).
3. On commit, set `onHand = count + intermediateDelta`.
4. Emit a synthetic **`StockTakeRebaseDelta`** equal to `onHand_new - onHand_prev` so remote devices converge.

**Concurrent case**
- If sales occur while the device is offline doing a stock‑take, those sales will be seen as part of `intermediateDelta` on reconciliation, so the absolute count is not clobbered.

---

## 6) Failure, Retries & Compensations (Sagas)

When syncing a bundle, apply **server‑side in a transaction** (Firestore batched write / transaction):
1) Create assignment doc (upsert idempotent by `assignmentId`).
2) Append product stock **delta event** (or update PN‑counters subdoc) and recompute materialized stock.
3) Append player **balance delta event** and recompute balance.

If the transaction fails mid‑way client‑side, the bundle remains in outbox; retries are safe thanks to idempotent `opId`s.

If the server partially applied (shouldn’t happen in a transaction), client detects **ack vector** mismatch and either:
- replays missing steps; or
- runs compensations (e.g., delete orphan assignment) based on a policy flag.

---

## 7) Read Reconciliation: Preventing Local Overwrites

**Do not** replace local entities with hydrated payloads. Instead:
- Store server state as `localBase`.
- Maintain `provisionalDeltas` keyed by bundle/step.
- At read time, **fold** the deltas onto `localBase`.
- On hydration, **merge**: new `localBase` + still‑pending `provisionals` ⇒ consistent views.

This stops the “server overwrote my local sale” symptom.

---

## 8) Server (Firebase) Contract & Security Rules

**Collections** (suggested):
- `/assignments/{assignmentId}` — immutable core fields; mutable flags (`paid`, `cancelled`).
- `/products/{productId}` — doc with materialized `onHand`, plus subcollection `/stockDeltas/{opId}` (signed deltas) **or** a PN‑counter map.
- `/players/{playerId}` — doc with materialized `balance`, plus subcollection `/balanceDeltas/{opId}`.
- `/bundles/{bundleId}` — optional, for audit/diagnostics.

**Server function / Firestore transaction** takes a `BundleOp` and:
- Rejects if any `opId` already applied with conflicting payload (ensures true idempotency).
- Applies all steps, commits once.

**Security rules** ensure:
- Only allowed roles can write specific deltas (reuses your permission system).
- No direct arbitrary overwrite of `onHand` or `balance` except via `StockTake` and admin flows.

---

## 9) Implementation Plan (TypeScript)

> The snippets below are designed to slot into your existing services and UI. They reference functions already present such as `createAssignmentTransaction`, `getProducts()`, `getPlayers()`, etc.

### 9.1 Data types
```ts
// ops/BundleOp.ts
export type OpSource = 'local' | 'server' | 'sync';

export interface StepResultAck { opId: string; appliedAt: number; }

export interface BundleOp {
  bundleId: string;
  type: 'assignmentSale' | 'stockTake' | 'payment';
  entityRefs: { assignmentId?: string; productId?: string; playerId?: string };
  steps: Array<{
    opId: string;               // deterministic hash(bundleId, stepName)
    kind: 'createAssignment' | 'stockDelta' | 'balanceDelta' | 'markPaid' | 'stockTakeRebase';
    payload: Record<string, any>;
  }>;
  vectorClock: Record<string, number>;
  timestamp: number;
  source: OpSource;
}
```

### 9.2 Client: create assignment as a bundle
```ts
// HybridSyncService.ts (client)
async createAssignmentTransaction(input: {
  assignmentId?: string;
  productId: string;
  productName: string;
  playerId: string;
  userName: string; // display name
  quantity: number;
  unitPrice: number;
  total: number;
  organizationId: string;
}) {
  const bundleId = input.assignmentId ?? this.uuid();
  const steps = [
    { opId: this.hash(bundleId, 'createAssignment'), kind: 'createAssignment', payload: {
        assignmentId: bundleId,
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
    { opId: this.hash(bundleId, 'stockDelta'), kind: 'stockDelta', payload: {
        productId: input.productId,
        delta: -Math.abs(input.quantity), // sale
      }
    },
    { opId: this.hash(bundleId, 'balanceDelta'), kind: 'balanceDelta', payload: {
        playerId: input.playerId,
        delta: +Math.abs(input.total),   // debit to player
      }
    },
  ];

  const bundle: BundleOp = {
    bundleId,
    type: 'assignmentSale',
    entityRefs: { assignmentId: bundleId, productId: input.productId, playerId: input.playerId },
    steps,
    vectorClock: this.bumpVectorClock(),
    timestamp: Date.now(),
    source: 'local',
  };

  // 1) Apply locally as provisional overlay (atomic in memory/local storage)
  await this.applyBundleLocally(bundle); // marks provisional

  // 2) Enqueue for sync (outbox)
  await this.enqueueBundle(bundle, { priority: 'high' });

  // 3) Best‑effort immediate sync
  if (await this.refreshNetworkState()) {
    this.syncLoopTick();
  }

  return bundle.bundleId;
}
```

### 9.3 Local application (provisional overlay)
```ts
private async applyBundleLocally(bundle: BundleOp) {
  for (const step of bundle.steps) {
    switch (step.kind) {
      case 'createAssignment':
        this.provisional.assignments.set(step.payload.assignmentId, step);
        break;
      case 'stockDelta':
        this.provisional.productStock.add(step.payload.productId, step.payload.delta, step.opId);
        break;
      case 'balanceDelta':
        this.provisional.playerLedger.add(step.payload.playerId, step.payload.delta, step.opId);
        break;
    }
  }
  await this.persistProvisional();
}
```

### 9.4 Outbox processing & server transaction
```ts
// HybridSyncService.ts
private async processBundle(bundle: BundleOp) {
  try {
    const ack: StepResultAck[] = await this.firebaseService.applyBundleTransaction(bundle);
    this.commitAcks(bundle, ack); // mark provisionals committed, prune overlays
  } catch (e) {
    // leave in outbox; retries are safe due to opId idempotency
    throw e;
  }
}
```

```ts
// FirebaseService.ts (server adapter)
async applyBundleTransaction(bundle: BundleOp): Promise<StepResultAck[]> {
  return this.runTransaction(async (tx) => {
    const acks: StepResultAck[] = [];

    for (const step of bundle.steps) {
      const already = await this.isStepApplied(tx, step.opId);
      if (already) { acks.push({ opId: step.opId, appliedAt: Date.now() }); continue; }

      switch (step.kind) {
        case 'createAssignment':
          await this.txCreateAssignment(tx, step.payload);
          break;
        case 'stockDelta':
          await this.txAppendStockDeltaAndRecompute(tx, step.payload);
          break;
        case 'balanceDelta':
          await this.txAppendBalanceDeltaAndRecompute(tx, step.payload);
          break;
        case 'stockTakeRebase':
          await this.txApplyStockTakeRebase(tx, step.payload);
          break;
      }

      await this.txMarkStepApplied(tx, step.opId, bundle);
      acks.push({ opId: step.opId, appliedAt: Date.now() });
    }

    return acks;
  });
}
```

### 9.5 Read reconciliation (overlay fold)
```ts
// Read path (examples)
async getProducts(): Promise<Product[]> {
  const base = await this.localStore.getProductsBase();
  const overlay = this.provisional.productStock.toDeltas();
  return foldProductOverlay(base, overlay);
}

function foldProductOverlay(base: Product[], deltas: {productId: string, delta: number}[]) {
  const byId = new Map(base.map(p => [p.id, { ...p }]));
  for (const d of deltas) {
    const p = byId.get(d.productId);
    if (p) p.stock = (p.stock ?? 0) + d.delta;
  }
  return [...byId.values()];
}
```

### 9.6 Stock‑take op & rebase
```ts
// Start stock‑take: capture base vector & snapshot
startStockTake(productId: string) {
  const base = this.getProductBaseWithVector(productId);
  return { productId, baseVector: base.vector, baseOnHand: base.onHand };
}

// Commit stock‑take with final count
async commitStockTake(ctx: { productId: string; count: number; baseVector: VClock }) {
  const bundleId = this.uuid();
  const steps = [{
    opId: this.hash(bundleId, 'stockTakeRebase'),
    kind: 'stockTakeRebase',
    payload: { productId: ctx.productId, count: ctx.count, baseVector: ctx.baseVector }
  }];
  const bundle: BundleOp = { bundleId, type: 'stockTake', entityRefs: { productId: ctx.productId }, steps, vectorClock: this.bumpVectorClock(), timestamp: Date.now(), source: 'local' };
  await this.applyBundleLocally(bundle);
  await this.enqueueBundle(bundle, { priority: 'normal' });
}
```

Server `txApplyStockTakeRebase` computes `intermediateDelta = Σ(sales since baseVector)` and sets `onHand = count + intermediateDelta`, then appends a derived delta so other devices converge.

### 9.7 Respect existing UI/API
- **Assignments page** continues to call `createAssignmentTransaction` — now implemented via bundles; UI remains unchanged.
- **Products page** & **UserSummary** continue reading via `getProducts()/getAssignments()`; reads now fold provisional overlays, preventing snap‑back on hydration.

---

## 10) Test Matrix

1. **Offline sale** → reconnect → verify assignment exists once, stock decremented once, player balance increased once.
2. **Network drop mid‑sync** → retries → no double‑apply (check `opId` markers).
3. **Stock‑take offline while online sales occur** → commit → rebase keeps both changes.
4. **Two devices sell same product concurrently** → PN‑counter semantics converge to correct on‑hand.
5. **Hydration arrives while local provisionals exist** → UI displays merged view, no overwrite.
6. **Mark paid** flows: paid/unpaid conflicts resolve with timestamp dominance on paid=true.

---

## 11) Rollout Strategy & Telemetry

- **Phased flag:** `FEATURE_TX_BUNDLES=true` gates new path.
- **Dual‑write (optional):** Write deltas + legacy fields, compare results.
- **Telemetry:** log bundle latency, retry count, step acks, convergence time.
- **Backfill:** one‑off script to derive initial `balanceDeltas` and `stockDeltas` from existing totals.
