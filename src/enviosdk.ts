/**
 * ALEXANDROS Manager Agent - Envio SDK
 * GraphQL client for Envio indexer - THE ONLY SOURCE OF TRUTH for performance
 * 
 * CRITICAL RULES:
 * - Backend MUST treat Envio as the only source of truth for performance
 * - Backend MUST NOT recalculate metrics
 * - Backend MUST NOT infer performance via RPC
 */

import { GraphQLClient, gql } from 'graphql-request'
import type {
  AgentId,
  PerformanceMetrics,
  EnvioQueryResult,
  ManagerConfig
} from './types.js'
import { getAuditLogger } from './auditLog.js'

// ===========================================
// GraphQL Queries
// ===========================================
const AGENT_PERFORMANCE_QUERY = gql`
  query AgentPerformance($agentId: String!, $periodStart: Int!, $periodEnd: Int!) {
    agentPerformance(
      where: { agentId: $agentId }
      periodStart: $periodStart
      periodEnd: $periodEnd
    ) {
      agentId
      roi
      drawdown
      gasEfficiency
      executionCount
      successRate
      lastExecutionAt
    }
  }
`

const AGENT_PERFORMANCE_BATCH_QUERY = gql`
  query AgentPerformanceBatch($agentIds: [String!]!, $periodStart: Int!, $periodEnd: Int!) {
    agentPerformances(
      where: { agentId_in: $agentIds }
      periodStart: $periodStart
      periodEnd: $periodEnd
    ) {
      agentId
      roi
      drawdown
      gasEfficiency
      executionCount
      successRate
      lastExecutionAt
    }
  }
`

const EXECUTION_EVENTS_QUERY = gql`
  query ExecutionEvents($agentId: String!, $limit: Int!) {
    executionEvents(
      where: { agentId: $agentId }
      first: $limit
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      agentId
      timestamp
      txHash
      target
      asset
      amount
      success
      gasUsed
      roi
    }
  }
`

const PERMISSION_EVENTS_QUERY = gql`
  query PermissionEvents($agentId: String!, $limit: Int!) {
    permissionEvents(
      where: { agentId: $agentId }
      first: $limit
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      permissionId
      agentId
      eventType
      timestamp
      txHash
      reason
    }
  }
`

const HEALTH_CHECK_QUERY = gql`
  query HealthCheck {
    _meta {
      block {
        number
        timestamp
      }
      hasIndexingErrors
    }
  }
`

// ===========================================
// Envio SDK Client
// ===========================================
export class EnvioSDK {
  private client: GraphQLClient
  private lastHealthCheck: number = 0
  private healthCheckInterval = 30000 // 30 seconds
  private isHealthy: boolean = true

  constructor(config: ManagerConfig) {
    this.client = new GraphQLClient(config.envioEndpoint, {
      headers: config.envioApiKey ? {
        'Authorization': `Bearer ${config.envioApiKey}`
      } : {}
    })
  }

  // ===========================================
  // Query Agent Performance (Primary Method)
  // ===========================================
  async queryAgentPerformance(
    agentId: AgentId,
    periodStart?: number,
    periodEnd?: number
  ): Promise<EnvioQueryResult> {
    const audit = getAuditLogger()
    const startTime = Date.now()

    // Default to last 7 days
    const now = Math.floor(Date.now() / 1000)
    const start = periodStart || now - (7 * 24 * 60 * 60)
    const end = periodEnd || now

    try {
      const response = await this.client.request<{
        agentPerformance: EnvioPerformanceResponse | null
      }>(AGENT_PERFORMANCE_QUERY, {
        agentId,
        periodStart: start,
        periodEnd: end
      })

      const responseTime = Date.now() - startTime

      if (!response.agentPerformance) {
        audit.logEnvioQuery(agentId, true, {
          queryType: 'agentPerformance',
          responseTime,
          error: 'No data found'
        })
        
        return {
          success: true,
          data: null,
          queriedAt: Date.now()
        }
      }

      const metrics = this.mapPerformanceResponse(response.agentPerformance, start, end)

      audit.logEnvioQuery(agentId, true, {
        queryType: 'agentPerformance',
        responseTime
      })

      return {
        success: true,
        data: metrics,
        queriedAt: Date.now()
      }
    } catch (error) {
      const responseTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      audit.logEnvioQuery(agentId, false, {
        queryType: 'agentPerformance',
        responseTime,
        error: errorMessage
      })

      return {
        success: false,
        data: null,
        error: errorMessage,
        queriedAt: Date.now()
      }
    }
  }

  // ===========================================
  // Batch Query Performance (Efficiency)
  // ===========================================
  async queryBatchPerformance(
    agentIds: AgentId[],
    periodStart?: number,
    periodEnd?: number
  ): Promise<Map<AgentId, EnvioQueryResult>> {
    const results = new Map<AgentId, EnvioQueryResult>()
    
    // Default to last 7 days
    const now = Math.floor(Date.now() / 1000)
    const start = periodStart || now - (7 * 24 * 60 * 60)
    const end = periodEnd || now

    try {
      const response = await this.client.request<{
        agentPerformances: EnvioPerformanceResponse[]
      }>(AGENT_PERFORMANCE_BATCH_QUERY, {
        agentIds,
        periodStart: start,
        periodEnd: end
      })

      // Map responses to agent IDs
      const responseMap = new Map<string, EnvioPerformanceResponse>()
      for (const perf of response.agentPerformances) {
        responseMap.set(perf.agentId, perf)
      }

      // Build results for all requested agents
      for (const agentId of agentIds) {
        const perfData = responseMap.get(agentId)
        
        if (perfData) {
          results.set(agentId, {
            success: true,
            data: this.mapPerformanceResponse(perfData, start, end),
            queriedAt: Date.now()
          })
        } else {
          results.set(agentId, {
            success: true,
            data: null,
            queriedAt: Date.now()
          })
        }
      }
    } catch (error) {
      // On batch failure, set error for all agents
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      for (const agentId of agentIds) {
        results.set(agentId, {
          success: false,
          data: null,
          error: errorMessage,
          queriedAt: Date.now()
        })
      }
    }

    return results
  }

  // ===========================================
  // Query Recent Execution Events
  // ===========================================
  async queryExecutionEvents(
    agentId: AgentId,
    limit: number = 50
  ): Promise<ExecutionEvent[]> {
    try {
      const response = await this.client.request<{
        executionEvents: ExecutionEvent[]
      }>(EXECUTION_EVENTS_QUERY, {
        agentId,
        limit
      })

      return response.executionEvents
    } catch {
      return []
    }
  }

  // ===========================================
  // Query Permission Events
  // ===========================================
  async queryPermissionEvents(
    agentId: AgentId,
    limit: number = 50
  ): Promise<PermissionEvent[]> {
    try {
      const response = await this.client.request<{
        permissionEvents: PermissionEvent[]
      }>(PERMISSION_EVENTS_QUERY, {
        agentId,
        limit
      })

      return response.permissionEvents
    } catch {
      return []
    }
  }

  // ===========================================
  // Health Check
  // ===========================================
  async checkHealth(): Promise<boolean> {
    const audit = getAuditLogger()
    const now = Date.now()

    // Rate limit health checks
    if (now - this.lastHealthCheck < this.healthCheckInterval && this.isHealthy) {
      return this.isHealthy
    }

    try {
      const response = await this.client.request<{
        _meta: {
          block: { number: number; timestamp: number }
          hasIndexingErrors: boolean
        }
      }>(HEALTH_CHECK_QUERY)

      this.lastHealthCheck = now

      // Check if indexer is healthy
      if (response._meta.hasIndexingErrors) {
        this.isHealthy = false
        audit.logEnvioUnavailable('Indexer has errors')
        return false
      }

      // Check if indexer is too far behind (more than 5 minutes)
      const blockAge = Math.floor(Date.now() / 1000) - response._meta.block.timestamp
      if (blockAge > 300) {
        this.isHealthy = false
        audit.logEnvioUnavailable(`Indexer is ${blockAge} seconds behind`)
        return false
      }

      this.isHealthy = true
      return true
    } catch (error) {
      this.isHealthy = false
      audit.logEnvioUnavailable(error instanceof Error ? error.message : 'Unknown error')
      return false
    }
  }

  // ===========================================
  // Get Health Status (Cached)
  // ===========================================
  isAvailable(): boolean {
    return this.isHealthy
  }

  // ===========================================
  // Map Response to Internal Type
  // ===========================================
  private mapPerformanceResponse(
    response: EnvioPerformanceResponse,
    periodStart: number,
    periodEnd: number
  ): PerformanceMetrics {
    return {
      agentId: response.agentId as AgentId,
      roi: response.roi,
      drawdown: response.drawdown,
      gasEfficiency: response.gasEfficiency,
      executionCount: response.executionCount,
      successRate: response.successRate,
      lastExecutionAt: response.lastExecutionAt,
      periodStart,
      periodEnd
    }
  }
}

// ===========================================
// Envio Response Types
// ===========================================
interface EnvioPerformanceResponse {
  agentId: string
  roi: number
  drawdown: number
  gasEfficiency: number
  executionCount: number
  successRate: number
  lastExecutionAt: number
}

interface ExecutionEvent {
  id: string
  agentId: string
  timestamp: number
  txHash: string
  target: string
  asset: string
  amount: string
  success: boolean
  gasUsed: string
  roi: number
}

interface PermissionEvent {
  id: string
  permissionId: string
  agentId: string
  eventType: string
  timestamp: number
  txHash: string
  reason: string
}

// ===========================================
// Singleton Instance
// ===========================================
let envioSDKInstance: EnvioSDK | null = null

export function initEnvioSDK(config: ManagerConfig): EnvioSDK {
  if (!envioSDKInstance) {
    envioSDKInstance = new EnvioSDK(config)
  }
  return envioSDKInstance
}

export function getEnvioSDK(): EnvioSDK {
  if (!envioSDKInstance) {
    throw new Error('EnvioSDK not initialized. Call initEnvioSDK first.')
  }
  return envioSDKInstance
}
