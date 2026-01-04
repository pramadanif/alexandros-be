/**
 * ALEXANDROS Manager Agent - Enhanced Envio GraphQL Queries
 * 
 * Queries aligned with alexandros-indexer schema.graphql
 * Use these to replace/extend existing queries in enviosdk.ts
 */

import { gql } from 'graphql-request'

// ===========================================
// Agent Performance Query (Aligned with Indexer)
// ===========================================
export const AGENT_PERFORMANCE_QUERY = gql`
  query AgentPerformance($agentId: String!) {
    agentPerformance(id: $agentId) {
      id
      roi
      drawdown
      gasEfficiency
      successRate
      executionCount
      successfulExecutions
      failedExecutions
      lastExecutionAt
      periodStart
      periodEnd
      totalValueProcessed
      totalGasUsed
      lastCalculatedAt
    }
  }
`

// ===========================================
// Agent Details Query
// ===========================================
export const AGENT_DETAILS_QUERY = gql`
  query AgentDetails($agentId: String!) {
    agent(id: $agentId) {
      id
      agentId
      codeHash
      status
      metadataHash
      owner
      strategyType
      registeredAt
      lastUpdatedAt
      bannedAt
      banReason
      createdAtBlock
      lastUpdatedAtBlock
      performance {
        roi
        drawdown
        gasEfficiency
        successRate
        executionCount
        lastExecutionAt
      }
    }
  }
`

// ===========================================
// Batch Agent Performance Query
// ===========================================
export const AGENT_PERFORMANCE_BATCH_QUERY = gql`
  query AgentPerformanceBatch($agentIds: [String!]!) {
    agentPerformances(where: { agent_in: $agentIds }) {
      id
      agent {
        id
        status
      }
      roi
      drawdown
      gasEfficiency
      successRate
      executionCount
      lastExecutionAt
      periodStart
      periodEnd
    }
  }
`

// ===========================================
// Permission Query (by User)
// ===========================================
export const USER_PERMISSIONS_QUERY = gql`
  query UserPermissions($userId: String!, $status: PermissionStatus) {
    permissions(
      where: { 
        grantor: $userId
        status: $status
      }
      orderBy: createdAt
      orderDirection: desc
    ) {
      id
      permissionId
      grantor
      grantee
      target
      selector
      asset
      maxAmount
      usedAmount
      status
      createdAt
      expiresAt
      revokedAt
      revocationReason
      isRevoked
      agent {
        id
        status
        codeHash
      }
    }
  }
`

// ===========================================
// Permission Query (by Agent)
// ===========================================
export const AGENT_PERMISSIONS_QUERY = gql`
  query AgentPermissions($agentId: String!) {
    permissions(
      where: { grantee: $agentId }
      orderBy: createdAt
      orderDirection: desc
    ) {
      id
      permissionId
      grantor
      grantee
      target
      status
      maxAmount
      usedAmount
      expiresAt
      createdAt
    }
  }
`

// ===========================================
// Active Permissions Count Query
// ===========================================
export const ACTIVE_PERMISSIONS_COUNT_QUERY = gql`
  query ActivePermissionsCount($agentId: String!) {
    permissions(where: { grantee: $agentId, status: ACTIVE }) {
      id
    }
  }
`

// ===========================================
// Execution Events Query
// ===========================================
export const EXECUTION_EVENTS_QUERY = gql`
  query ExecutionEvents($agentId: String!, $limit: Int!) {
    executions(
      where: { agentAddress: $agentId }
      first: $limit
      orderBy: blockTimestamp
      orderDirection: desc
    ) {
      id
      permissionId
      agentAddress
      target
      selector
      value
      txHash
      blockNumber
      blockTimestamp
      gasUsed
      success
      roiContribution
      assetAmount
    }
  }
`

// ===========================================
// Audit Events Query
// ===========================================
export const AUDIT_EVENTS_QUERY = gql`
  query AuditEvents(
    $agentId: String
    $permissionId: String
    $eventType: AuditEventType
    $from: Int!
    $to: Int!
    $limit: Int!
  ) {
    auditEvents(
      where: {
        agent: $agentId
        permissionId: $permissionId
        eventType: $eventType
        blockTimestamp_gte: $from
        blockTimestamp_lte: $to
      }
      first: $limit
      orderBy: blockTimestamp
      orderDirection: desc
    ) {
      id
      eventType
      permissionId
      agentId
      user
      reason
      details
      txHash
      blockNumber
      blockTimestamp
      logIndex
      initiatedBy
    }
  }
`

// ===========================================
// Protocol Statistics Query
// ===========================================
export const PROTOCOL_STATS_QUERY = gql`
  query ProtocolStats {
    protocolStats(id: "alexandros-stats") {
      totalAgents
      activeAgents
      bannedAgents
      totalPermissionsGranted
      activePermissions
      revokedPermissions
      expiredPermissions
      totalExecutions
      successfulExecutions
      failedExecutions
      totalValueProcessed
      totalGasUsed
      lastUpdatedAt
      lastUpdatedAtBlock
    }
  }
`

// ===========================================
// Daily Statistics Query
// ===========================================
export const DAILY_STATS_QUERY = gql`
  query DailyStats($from: Int!, $to: Int!) {
    dailyStatss(
      where: {
        date_gte: $from
        date_lte: $to
      }
      orderBy: date
      orderDirection: asc
    ) {
      id
      date
      newAgents
      newPermissions
      permissionsRevoked
      permissionsExpired
      executionCount
      successfulExecutions
      failedExecutions
      valueProcessed
      gasUsed
      averageRoi
      averageSuccessRate
    }
  }
`

// ===========================================
// User Account Query
// ===========================================
export const USER_ACCOUNT_QUERY = gql`
  query UserAccount($userId: String!) {
    userAccount(id: $userId) {
      id
      address
      totalPermissionsGranted
      activePermissions
      revokedPermissions
      expiredPermissions
      firstActivityAt
      lastActivityAt
      totalValueDelegated
    }
  }
`

// ===========================================
// Health Check Query (aligned with Indexer)
// ===========================================
export const HEALTH_CHECK_QUERY = gql`
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
// Type Definitions (for TypeScript)
// ===========================================

export interface IndexerAgentPerformance {
  id: string
  roi: number
  drawdown: number
  gasEfficiency: number
  successRate: number
  executionCount: number
  successfulExecutions: number
  failedExecutions: number
  lastExecutionAt: number
  periodStart: number
  periodEnd: number
  totalValueProcessed: string // BigInt as string
  totalGasUsed: string
  lastCalculatedAt: number
}

export interface IndexerAgent {
  id: string
  agentId: string
  codeHash: string
  status: 'ACTIVE' | 'UPDATED' | 'BANNED' | 'UNREGISTERED'
  metadataHash?: string
  owner: string
  strategyType?: 'YIELD' | 'SWAP' | 'BRIDGE' | 'DEX_AGGREGATION' | 'CUSTOM'
  registeredAt: number
  lastUpdatedAt: number
  bannedAt?: number
  banReason?: string
  performance?: IndexerAgentPerformance
}

export interface IndexerPermission {
  id: string
  permissionId: string
  grantor: string
  grantee: string
  target: string
  selector?: string
  asset?: string
  maxAmount?: string
  usedAmount: string
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED'
  createdAt: number
  expiresAt: number
  revokedAt?: number
  revocationReason?: string
  isRevoked: boolean
  agent?: IndexerAgent
}

export interface IndexerExecution {
  id: string
  permissionId: string
  agentAddress: string
  target: string
  selector: string
  value: string
  txHash: string
  blockNumber: number
  blockTimestamp: number
  gasUsed?: string
  success: boolean
  roiContribution?: number
  assetAmount?: string
}

export interface IndexerAuditEvent {
  id: string
  eventType: string
  permissionId?: string
  agentId?: string
  user?: string
  reason?: string
  details?: string
  txHash: string
  blockNumber: number
  blockTimestamp: number
  logIndex: number
  initiatedBy?: string
}

export interface IndexerProtocolStats {
  totalAgents: number
  activeAgents: number
  bannedAgents: number
  totalPermissionsGranted: number
  activePermissions: number
  revokedPermissions: number
  expiredPermissions: number
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  totalValueProcessed: string
  totalGasUsed: string
  lastUpdatedAt: number
  lastUpdatedAtBlock: number
}

export interface IndexerDailyStats {
  id: string
  date: number
  newAgents: number
  newPermissions: number
  permissionsRevoked: number
  permissionsExpired: number
  executionCount: number
  successfulExecutions: number
  failedExecutions: number
  valueProcessed: string
  gasUsed: string
  averageRoi?: number
  averageSuccessRate?: number
}
