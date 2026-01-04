/**
 * ALEXANDROS Manager Agent - Type Definitions
 * Core types for the autonomous policy enforcer
 */

import type { Address, Hex } from 'viem'

// ===========================================
// Brand Types for Type Safety
// ===========================================
export type AgentId = Address & { readonly __brand: 'AgentId' }
export type PermissionId = Hex & { readonly __brand: 'PermissionId' }
export type SessionKeyId = string & { readonly __brand: 'SessionKeyId' }
export type CodeHash = Hex & { readonly __brand: 'CodeHash' }

// ===========================================
// ERC-8004 Agent Registry Types
// ===========================================
export const AgentStatus = {
  ACTIVE: 'ACTIVE',
  UPDATED: 'UPDATED',
  BANNED: 'BANNED',
  UNREGISTERED: 'UNREGISTERED'
} as const
export type AgentStatus = typeof AgentStatus[keyof typeof AgentStatus]

export const StrategyType = {
  YIELD: 'yield',
  SWAP: 'swap',
  BRIDGE: 'bridge',
  DEX_AGGREGATION: 'dex_aggregation',
  CUSTOM: 'custom'
} as const
export type StrategyType = typeof StrategyType[keyof typeof StrategyType]

export interface RegisteredAgent {
  id: AgentId
  codeHash: CodeHash
  status: AgentStatus
  metadataHash: Hex
  lastUpdated: number
  owner: Address
  strategyType: StrategyType
  registrationDate: number
}

export const AgentVerificationReason = {
  VERIFIED: 'VERIFIED',
  UNREGISTERED: 'UNREGISTERED',
  BANNED: 'BANNED',
  CODE_HASH_MISMATCH: 'CODE_HASH_MISMATCH',
  REGISTRY_UNAVAILABLE: 'REGISTRY_UNAVAILABLE',
  INVALID_METADATA: 'INVALID_METADATA'
} as const
export type AgentVerificationReason = typeof AgentVerificationReason[keyof typeof AgentVerificationReason]

export interface AgentVerificationResult {
  verified: boolean
  agent: RegisteredAgent | null
  reason: AgentVerificationReason
  timestamp: number
}

// ===========================================
// EIP-7702 Permission Types
// ===========================================
export const PermissionStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED'
} as const
export type PermissionStatus = typeof PermissionStatus[keyof typeof PermissionStatus]

export const RevocationReason = {
  USER_INITIATED: 'USER_INITIATED',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  ROI_THRESHOLD: 'ROI_THRESHOLD',
  GAS_INEFFICIENCY: 'GAS_INEFFICIENCY',
  SUCCESS_RATE_LOW: 'SUCCESS_RATE_LOW',
  INACTIVITY: 'INACTIVITY',
  AGENT_BANNED: 'AGENT_BANNED',
  EXPIRED: 'EXPIRED',
  SYSTEM_SAFETY: 'SYSTEM_SAFETY'
} as const
export type RevocationReason = typeof RevocationReason[keyof typeof RevocationReason]

export interface Permission {
  id: PermissionId
  grantor: Address
  grantee: AgentId
  target: Address
  selector: Hex
  asset: Address
  maxAmount: bigint
  usedAmount: bigint
  expiresAt: number
  sessionKeyHash: Hex
  status: PermissionStatus
  createdAt: number
  revokedAt?: number
  revokedReason?: RevocationReason
}

export interface PermissionGrant {
  grantee: AgentId
  target: Address
  selector: Hex
  asset: Address
  maxAmount: bigint
  duration: number
  sessionKeyId: SessionKeyId
}

export interface PermissionRevocation {
  permissionId: PermissionId
  reason: RevocationReason
  metricsSnapshot: PerformanceMetrics
}

// ===========================================
// P256 Session Key Types
// ===========================================
export interface PermissionScope {
  assets: Address[]
  targets: Address[]
  maxAmounts: Record<Address, bigint>
  selectors: Hex[]
}

export interface SessionKey {
  id: SessionKeyId
  publicKey: Hex
  agentId: AgentId
  permissionScope: PermissionScope
  createdAt: number
  expiresAt: number
  isRevoked: boolean
  revokedAt?: number
}

export interface SessionKeyGeneration {
  agentId: AgentId
  scope: PermissionScope
  duration: number
}

// ===========================================
// Envio Performance Types
// ===========================================
export interface PerformanceMetrics {
  agentId: AgentId
  roi: number
  drawdown: number
  gasEfficiency: number
  executionCount: number
  successRate: number
  lastExecutionAt: number
  periodStart: number
  periodEnd: number
}

export interface EnvioQueryResult {
  success: boolean
  data: PerformanceMetrics | null
  error?: string
  queriedAt: number
}

// ===========================================
// Policy Engine Types
// ===========================================
export const PolicyDecision = {
  MAINTAIN: 'MAINTAIN',
  EXTEND: 'EXTEND',
  DOWNGRADE: 'DOWNGRADE',
  REVOKE: 'REVOKE'
} as const
export type PolicyDecision = typeof PolicyDecision[keyof typeof PolicyDecision]

export interface PolicyThresholds {
  roiRevoke: number
  roiExtend: number
  gasEfficiencyMin: number
  successRateMin: number
  maxInactivitySeconds: number
  drawdownMax: number
}

export interface PolicyRuleResult {
  ruleName: string
  passed: boolean
  actual: number | string
  threshold: number | string
  message: string
}

export interface PolicyEvaluation {
  agentId: AgentId
  permissionId: PermissionId
  decision: PolicyDecision
  reason: string
  metrics: PerformanceMetrics
  thresholds: PolicyThresholds
  evaluatedAt: number
  rules: PolicyRuleResult[]
}

// ===========================================
// Audit Log Types
// ===========================================
export const AuditEventType = {
  AGENT_VERIFIED: 'AGENT_VERIFIED',
  AGENT_VERIFICATION_FAILED: 'AGENT_VERIFICATION_FAILED',
  SESSION_KEY_GENERATED: 'SESSION_KEY_GENERATED',
  SESSION_KEY_REVOKED: 'SESSION_KEY_REVOKED',
  PERMISSION_GRANTED: 'PERMISSION_GRANTED',
  PERMISSION_REVOKED: 'PERMISSION_REVOKED',
  PERMISSION_EXTENDED: 'PERMISSION_EXTENDED',
  PERMISSION_DOWNGRADED: 'PERMISSION_DOWNGRADED',
  POLICY_EVALUATION: 'POLICY_EVALUATION',
  ENVIO_QUERY: 'ENVIO_QUERY',
  ENVIO_UNAVAILABLE: 'ENVIO_UNAVAILABLE',
  REGISTRY_UNAVAILABLE: 'REGISTRY_UNAVAILABLE',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  LOOP_CYCLE_START: 'LOOP_CYCLE_START',
  LOOP_CYCLE_END: 'LOOP_CYCLE_END'
} as const
export type AuditEventType = typeof AuditEventType[keyof typeof AuditEventType]

export interface AuditEntry {
  id: string
  timestamp: number
  eventType: AuditEventType
  agentId?: AgentId
  permissionId?: PermissionId
  sessionKeyId?: SessionKeyId
  details: Record<string, unknown>
  metricsSnapshot?: PerformanceMetrics
  decision?: PolicyDecision
  reason?: string
}

// ===========================================
// Orchestrator State Types
// ===========================================
export interface AgentState {
  agentId: AgentId
  verificationStatus: AgentVerificationResult
  activePermissions: PermissionId[]
  sessionKeys: SessionKeyId[]
  lastEvaluatedAt: number
  lastMetrics?: PerformanceMetrics
}

export interface OrchestratorState {
  isRunning: boolean
  lastCycleAt: number
  cycleCount: number
  activeAgents: Map<AgentId, AgentState>
  envioAvailable: boolean
  registryAvailable: boolean
  frozen: boolean
  frozenReason?: string
}

// ===========================================
// Configuration Types
// ===========================================
export interface ManagerConfig {
  chainId: number
  rpcUrl: string
  envioEndpoint: string
  envioApiKey?: string
  contracts: {
    erc8004Registry: Address
    eip7702PermissionManager: Address
    alexandrosCore: Address
  }
  managerAgent: {
    address: Address
    privateKey: Hex
  }
  execution: {
    intervalMs: number
    maxAgentsPerCycle: number
    loopTimeoutMs: number
  }
  policy: PolicyThresholds
  safety: {
    envioUnavailableFreeze: boolean
    registryUnreachableRevoke: boolean
    maxPermissionDurationSeconds: number
  }
  audit: {
    logPath: string
    maxSize: number
    maxFiles: number
  }
}

// ===========================================
// Error Types
// ===========================================
export const ErrorCode = {
  ENVIO_UNAVAILABLE: 'ENVIO_UNAVAILABLE',
  REGISTRY_UNAVAILABLE: 'REGISTRY_UNAVAILABLE',
  PERMISSION_GRANT_FAILED: 'PERMISSION_GRANT_FAILED',
  PERMISSION_REVOKE_FAILED: 'PERMISSION_REVOKE_FAILED',
  SESSION_KEY_GENERATION_FAILED: 'SESSION_KEY_GENERATION_FAILED',
  POLICY_EVALUATION_FAILED: 'POLICY_EVALUATION_FAILED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  CONFIGURATION_INVALID: 'CONFIGURATION_INVALID',
  SYSTEM_FROZEN: 'SYSTEM_FROZEN'
} as const
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode]

export class ManagerError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly recoverable: boolean,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ManagerError'
  }
}
