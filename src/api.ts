/**
 * ALEXANDROS Manager Agent - API Endpoints
 * Minimal API for frontend integration and monitoring
 * 
 * NOTE: This is NOT a traditional API server.
 * These endpoints exist solely for:
 * - Frontend status monitoring
 * - Kill-switch triggering
 * - Audit log access
 */

import type { Address } from 'viem'
import type {
  AgentId,
  PermissionId,
  OrchestratorState,
  PolicyThresholds
} from './types.js'

// ===========================================
// API Response Types
// ===========================================
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  timestamp: number
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  services: {
    envio: boolean
    registry: boolean
    orchestrator: boolean
  }
  lastCycleAt: number
  cycleCount: number
  frozen: boolean
  frozenReason?: string
}

export interface AgentStatusResponse {
  agentId: AgentId
  verified: boolean
  verificationReason: string
  activePermissions: number
  lastEvaluatedAt: number
  lastMetrics?: {
    roi: number
    drawdown: number
    gasEfficiency: number
    successRate: number
  }
}

export interface PermissionStatusResponse {
  permissionId: PermissionId
  agentId: AgentId
  status: string
  target: Address
  asset: Address
  maxAmount: string
  usedAmount: string
  expiresAt: number
  createdAt: number
}

export interface KillSwitchRequest {
  agentId: AgentId
  reason: string
  initiatedBy: Address
  signature: string
}

export interface KillSwitchResponse {
  success: boolean
  revokedPermissions: number
  revokedSessionKeys: number
  timestamp: number
}

export interface AuditLogQuery {
  agentId?: AgentId
  permissionId?: PermissionId
  eventType?: string
  fromTimestamp?: number
  toTimestamp?: number
  limit?: number
}

export interface AuditLogEntry {
  id: string
  timestamp: number
  eventType: string
  agentId?: AgentId
  permissionId?: PermissionId
  decision?: string
  reason?: string
  metricsSnapshot?: {
    roi: number
    drawdown: number
    gasEfficiency: number
    successRate: number
  }
}

// ===========================================
// API Endpoint Definitions (For Frontend)
// ===========================================

/**
 * GET /health
 * Returns system health status
 */
export interface GetHealthEndpoint {
  response: ApiResponse<HealthStatus>
}

/**
 * GET /agents/:agentId/status
 * Returns current status of an agent
 */
export interface GetAgentStatusEndpoint {
  params: { agentId: AgentId }
  response: ApiResponse<AgentStatusResponse>
}

/**
 * GET /agents/:agentId/permissions
 * Returns all permissions for an agent
 */
export interface GetAgentPermissionsEndpoint {
  params: { agentId: AgentId }
  response: ApiResponse<PermissionStatusResponse[]>
}

/**
 * POST /kill-switch
 * Triggers emergency revocation for an agent
 * ALWAYS succeeds if signature is valid
 */
export interface PostKillSwitchEndpoint {
  body: KillSwitchRequest
  response: ApiResponse<KillSwitchResponse>
}

/**
 * GET /audit
 * Query audit log entries
 */
export interface GetAuditLogEndpoint {
  query: AuditLogQuery
  response: ApiResponse<AuditLogEntry[]>
}

/**
 * GET /policy/thresholds
 * Returns current policy thresholds
 */
export interface GetPolicyThresholdsEndpoint {
  response: ApiResponse<PolicyThresholds>
}

/**
 * GET /metrics
 * Returns orchestrator metrics for monitoring
 */
export interface GetMetricsEndpoint {
  response: ApiResponse<{
    cyclesCompleted: number
    agentsMonitored: number
    permissionsActive: number
    permissionsRevokedTotal: number
    permissionsExtendedTotal: number
    averageCycleDurationMs: number
    lastCycleAt: number
  }>
}

// ===========================================
// API Route Handlers (Implementation Stubs)
// ===========================================

/**
 * These are implementation stubs showing the expected behavior.
 * The actual implementation depends on your HTTP framework choice
 * (Express, Fastify, Hono, etc.)
 */

export const apiHandlers = {
  /**
   * Health check handler
   */
  health: async (
    getOrchestratorState: () => OrchestratorState
  ): Promise<ApiResponse<HealthStatus>> => {
    const state = getOrchestratorState()
    
    const status: 'healthy' | 'degraded' | 'unhealthy' = 
      state.frozen ? 'unhealthy' :
      (!state.envioAvailable || !state.registryAvailable) ? 'degraded' :
      'healthy'

    return {
      success: true,
      data: {
        status,
        services: {
          envio: state.envioAvailable,
          registry: state.registryAvailable,
          orchestrator: state.isRunning
        },
        lastCycleAt: state.lastCycleAt,
        cycleCount: state.cycleCount,
        frozen: state.frozen,
        frozenReason: state.frozenReason
      },
      timestamp: Date.now()
    }
  },

  /**
   * Kill switch handler
   * CRITICAL: Must always succeed if signature is valid
   */
  killSwitch: async (
    request: KillSwitchRequest,
    forceRevocation: (agentId: AgentId, reason: string) => Promise<number>
  ): Promise<ApiResponse<KillSwitchResponse>> => {
    // NOTE: Signature verification should be implemented here
    // This is a critical security function
    
    try {
      const revokedPermissions = await forceRevocation(
        request.agentId,
        `KILL_SWITCH: ${request.reason}`
      )

      return {
        success: true,
        data: {
          success: true,
          revokedPermissions,
          revokedSessionKeys: 0, // Will be revoked with permissions
          timestamp: Date.now()
        },
        timestamp: Date.now()
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      }
    }
  }
}

// ===========================================
// WebSocket Event Types (For Real-time Updates)
// ===========================================

export enum WebSocketEventType {
  CYCLE_START = 'cycle:start',
  CYCLE_END = 'cycle:end',
  PERMISSION_GRANTED = 'permission:granted',
  PERMISSION_REVOKED = 'permission:revoked',
  PERMISSION_EXTENDED = 'permission:extended',
  PERMISSION_DOWNGRADED = 'permission:downgraded',
  AGENT_VERIFIED = 'agent:verified',
  AGENT_VERIFICATION_FAILED = 'agent:verification_failed',
  SYSTEM_FROZEN = 'system:frozen',
  SYSTEM_UNFROZEN = 'system:unfrozen',
  HEALTH_CHANGED = 'health:changed'
}

export interface WebSocketEvent {
  type: WebSocketEventType
  timestamp: number
  data: Record<string, unknown>
}
