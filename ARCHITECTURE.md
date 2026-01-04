# ALEXANDROS Manager Agent - Backend Architecture

## Overview

The Manager Agent backend is an **autonomous policy enforcer and permission orchestrator** operating on top of:

- **EIP-7702 Advanced Permissions**
- **ERC-8004 Agent Registry**
- **MetaMask Smart Accounts Kit**
- **Envio Indexing (GraphQL)**

> **Critical**: This backend does NOT custody funds, does NOT make trades, and does NOT compute analytics. Its sole responsibility is **enforcing conditional trust**.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ALEXANDROS Manager Agent                              │
│                     "Autonomous Risk Officer for Programmable Trust"         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐      │
│  │   main.ts  │───▶│ registry.ts│    │permissions │    │ enviosdk.ts│      │
│  │            │    │ (ERC-8004) │    │    .ts     │    │  (Envio)   │      │
│  │ Lifecycle  │    │            │    │ (EIP-7702) │    │            │      │
│  │ Scheduler  │    │  Agent     │    │            │    │ Performance│      │
│  │            │    │  Verify    │    │ Grant      │    │  Metrics   │      │
│  └─────┬──────┘    └─────┬──────┘    │ Revoke     │    │  (ROI,Gas) │      │
│        │                 │           │ Extend     │    │            │      │
│        │                 │           │ Downgrade  │    └─────┬──────┘      │
│        │                 │           └─────┬──────┘          │             │
│        │                 │                 │                 │             │
│        ▼                 ▼                 ▼                 ▼             │
│  ┌─────────────────────────────────────────────────────────────────┐      │
│  │                     policyEngine.ts                               │      │
│  │                  (Deterministic Rules)                            │      │
│  │                                                                   │      │
│  │  if (!agent.isVerified) → REVOKE                                 │      │
│  │  if (metrics.roi < -0.03) → REVOKE                               │      │
│  │  if (metrics.gasEfficiency < 0.7) → DOWNGRADE                    │      │
│  │  if (metrics.successRate < 0.9) → DOWNGRADE                      │      │
│  │  if (metrics.roi > 0.05) → EXTEND                                │      │
│  │  else → MAINTAIN                                                  │      │
│  └─────────────────────────────────────────────────────────────────┘      │
│        │                                                                   │
│        ▼                                                                   │
│  ┌─────────────┐    ┌────────────┐                                        │
│  │sessionKeys  │    │ auditLog.ts│                                        │
│  │    .ts      │    │            │                                        │
│  │  (P256)     │    │ Append-Only│                                        │
│  │             │    │   Logs     │                                        │
│  └─────────────┘    └────────────┘                                        │
│                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
        ┌───────────────────────────────────────────────────────────┐
        │                    External Systems                        │
        │                                                            │
        │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
        │  │ ERC-8004 │  │ EIP-7702 │  │  Envio   │  │ Frontend │  │
        │  │ Registry │  │Permission│  │  Indexer │  │   API    │  │
        │  │ (Chain)  │  │ Manager  │  │ (GraphQL)│  │          │  │
        │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
        └───────────────────────────────────────────────────────────┘
```

---

## Module Responsibilities

### `main.ts` - Lifecycle & Scheduler

**Responsibilities:**
- Initialize all services
- Execute the canonical evaluation loop
- Handle graceful shutdown
- Coordinate health checks

**MUST:**
- Run evaluation loop at configurable intervals
- Process agents in priority order
- Respect system freeze conditions

### `registry.ts` - ERC-8004 Verification

**Responsibilities:**
- Fetch agent metadata from ERC-8004 registry
- Validate code hash, verification status, strategy type
- Reject unregistered/banned agents

**Hard Rule:** No permission may be granted before registry verification succeeds.

### `permissions.ts` - EIP-7702 Orchestration

**Responsibilities:**
- Grant scoped permissions
- Revoke permissions with reason
- Extend or downgrade based on policy
- Bind permissions to session keys

**Constraints:**
- Respect allowance caps
- Respect scope boundaries
- Always expose revocation path

### `sessionKeys.ts` - P256 Key Management

**Responsibilities:**
- Generate ephemeral P256 session keys
- Bind keys to agent ID and permission scope
- Auto-expire or revoke keys

**Security Rules:**
- Keys are NEVER reused
- Keys are NEVER stored in plaintext long-term
- Revocation immediately invalidates the key

### `enviosdk.ts` - Envio GraphQL Client

**Responsibilities:**
- Query agent performance metrics
- Check indexer health
- Handle unavailability gracefully

**Critical:** Backend MUST treat Envio as the **only source of truth** for performance.

### `policyEngine.ts` - Deterministic Rules

**Responsibilities:**
- Evaluate agents against policy rules
- Generate explainable decisions
- Map decisions to actions

**Requirements:**
- Rule-based
- Explainable
- Reproducible

**Forbidden:**
- ML models
- Heuristics without thresholds
- Hidden weights

### `auditLog.ts` - Append-Only Logs

**Responsibilities:**
- Log every decision with reason
- Log metric snapshots
- Log timestamps
- Support forensic analysis

---

## Execution Loop (Canonical)

```typescript
while (running) {
  for (const agent of activeAgents) {
    // 1. Verify registry status
    const verification = await registry.verifyAgent(agent.id)
    
    // 2. Fetch Envio metrics (ONLY source of truth)
    const metrics = await envio.queryAgentPerformance(agent.id)
    
    // 3. Evaluate policy (deterministic)
    const evaluation = policy.evaluate(agent, metrics, verification)
    
    // 4. Execute decision
    switch (evaluation.decision) {
      case REVOKE:
        await permissions.revoke(agent.permissionId, evaluation.reason)
        break
      case EXTEND:
        await permissions.extend(agent.permissionId)
        break
      case DOWNGRADE:
        await permissions.downgrade(agent.permissionId)
        break
      case MAINTAIN:
        // No action
        break
    }
    
    // 5. Log outcome (ALWAYS)
    audit.log(evaluation)
  }
  
  await sleep(config.intervalMs)
}
```

---

## Permission Lifecycle State Machine

```
                    ┌─────────────┐
                    │   PENDING   │
                    └──────┬──────┘
                           │ grant()
                           ▼
                    ┌─────────────┐
         ┌─────────│   ACTIVE    │─────────┐
         │         └──────┬──────┘         │
         │                │                │
    extend()         downgrade()      revoke()
         │                │                │
         ▼                ▼                ▼
  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │   ACTIVE    │  │   ACTIVE    │  │   REVOKED   │
  │ (extended)  │  │ (reduced)   │  │             │
  └─────────────┘  └─────────────┘  └─────────────┘
                                          ▲
                                          │
                    ┌─────────────┐        │
                    │   EXPIRED   │────────┘
                    └─────────────┘
                           ▲
                           │ time > expiresAt
                    ┌──────┴──────┐
                    │   ACTIVE    │
                    └─────────────┘
```

### State Transitions

| From | To | Trigger | Audit Event |
|------|-----|---------|-------------|
| PENDING | ACTIVE | `grant()` | `PERMISSION_GRANTED` |
| ACTIVE | ACTIVE | `extend()` | `PERMISSION_EXTENDED` |
| ACTIVE | ACTIVE | `downgrade()` | `PERMISSION_DOWNGRADED` |
| ACTIVE | REVOKED | `revoke()` | `PERMISSION_REVOKED` |
| ACTIVE | EXPIRED | time | `PERMISSION_EXPIRED` |
| EXPIRED | REVOKED | cleanup | auto |

---

## Failure Mode Analysis

### Envio Unavailable

**Behavior:** FREEZE permission changes
```
if (!envio.isAvailable()) {
  state.frozen = true
  state.frozenReason = 'Envio unavailable'
  // No grants, no revocations, no extensions
}
```

**Rationale:** Without performance data, we cannot make informed decisions.

### Registry Unreachable

**Behavior:** Block NEW grants, maintain existing
```
if (!registry.isAvailable()) {
  // Block new permission grants
  // Existing permissions continue (bounded by expiry)
}
```

**Rationale:** Cannot verify agents without registry access.

### Backend Crash

**Behavior:** Permissions remain bounded
- All permissions have `expiresAt` timestamps
- Smart contract enforces expiration on-chain
- System recovers and resumes on restart

### User Kill-Switch

**Behavior:** ALWAYS respected
```
// User-initiated revocation bypasses all policy
await forceRevocation(agentId, 'USER_KILL_SWITCH')
```

**Guarantee:** User control is paramount.

---

## Responsibility Boundaries

### Frontend (FE)

| ✅ MUST DO | ❌ MUST NOT DO |
|------------|----------------|
| Display agent status | Compute metrics |
| Show permissions | Make policy decisions |
| Trigger kill-switch | Grant permissions directly |
| Display audit log | Bypass backend |

### Backend (BE - This Service)

| ✅ MUST DO | ❌ MUST NOT DO |
|------------|----------------|
| Verify agents (ERC-8004) | Execute DeFi strategies |
| Generate session keys | Compute ROI locally |
| Grant/revoke permissions | Bypass Envio |
| Enforce policy rules | Override kill-switch |
| Query Envio metrics | Custody funds |

### Smart Contract (SC)

| ✅ MUST DO | ❌ MUST NOT DO |
|------------|----------------|
| Store permissions | Make policy decisions |
| Validate executions | Query external APIs |
| Enforce time bounds | Store metrics |
| Emit events for indexing | Complex computation |

---

## Configuration Reference

```env
# Evaluation Loop
EVALUATION_INTERVAL_MS=30000      # 30 seconds between cycles
MAX_AGENTS_PER_CYCLE=50           # Agents processed per cycle
LOOP_TIMEOUT_MS=60000             # Max cycle duration

# Policy Thresholds
ROI_REVOKE_THRESHOLD=-0.03        # -3% triggers revocation
ROI_EXTEND_THRESHOLD=0.05         # +5% allows extension
GAS_EFFICIENCY_MIN=0.7            # 70% minimum
SUCCESS_RATE_MIN=0.9              # 90% minimum
MAX_INACTIVITY_SECONDS=604800     # 7 days max inactive

# Safety
ENVIO_UNAVAILABLE_FREEZE=true     # Freeze on Envio failure
REGISTRY_UNREACHABLE_REVOKE=true  # Block grants on registry failure
MAX_PERMISSION_DURATION_SECONDS=2592000  # 30 days max
```

---

## Success Criteria

The backend should feel like:

> **"An autonomous risk officer enforcing programmable trust."**

If your implementation could be replaced by a cron job + if/else, it is NOT sufficient.

The system must:
1. **Never grant unverified agents**
2. **Always log decisions with metrics**
3. **Respect user kill-switch unconditionally**
4. **Fail safe (freeze on Envio unavailable)**
5. **Be fully auditable and explainable**
