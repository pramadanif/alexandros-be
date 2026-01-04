/**
 * ALEXANDROS Manager Agent - Audit Logger
 * Append-only audit log for all permission and policy decisions
 * Every decision MUST be logged with reason, metrics, and timestamp
 */

import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import pino from 'pino'
import type {
  AuditEntry,
  AuditEventType,
  AgentId,
  PermissionId,
  SessionKeyId,
  PerformanceMetrics,
  PolicyDecision,
  ManagerConfig
} from './types.js'

// ===========================================
// Audit Logger Service
// ===========================================
export class AuditLogger {
  private logger: pino.Logger
  private entryCount = 0

  constructor(config: ManagerConfig['audit']) {
    // Ensure log directory exists
    const logDir = dirname(config.logPath)
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
    }

    // Create pino logger with file transport
    this.logger = pino({
      level: 'info',
      timestamp: () => `,"timestamp":${Date.now()}`,
      base: {
        service: 'alexandros-manager-agent',
        version: '1.0.0'
      }
    }, pino.destination({
      dest: config.logPath,
      sync: false,
      mkdir: true
    }))
  }

  // ===========================================
  // Core Logging Method
  // ===========================================
  private log(entry: AuditEntry): void {
    this.entryCount++
    
    // Structured log with all required fields
    this.logger.info({
      auditId: entry.id,
      eventType: entry.eventType,
      agentId: entry.agentId,
      permissionId: entry.permissionId,
      sessionKeyId: entry.sessionKeyId,
      decision: entry.decision,
      reason: entry.reason,
      details: entry.details,
      metricsSnapshot: entry.metricsSnapshot
    }, `[AUDIT] ${entry.eventType}`)
  }

  // ===========================================
  // Generate Unique Entry ID
  // ===========================================
  private generateId(eventType: AuditEventType): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    return `${eventType}-${timestamp}-${random}`
  }

  // ===========================================
  // Agent Verification Events
  // ===========================================
  logAgentVerified(
    agentId: AgentId,
    details: { codeHash: string; strategyType: string; owner: string }
  ): void {
    this.log({
      id: this.generateId('AGENT_VERIFIED' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'AGENT_VERIFIED' as AuditEventType,
      agentId,
      details
    })
  }

  logAgentVerificationFailed(
    agentId: AgentId,
    reason: string,
    details: Record<string, unknown>
  ): void {
    this.log({
      id: this.generateId('AGENT_VERIFICATION_FAILED' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'AGENT_VERIFICATION_FAILED' as AuditEventType,
      agentId,
      reason,
      details
    })
  }

  // ===========================================
  // Session Key Events
  // ===========================================
  logSessionKeyGenerated(
    sessionKeyId: SessionKeyId,
    agentId: AgentId,
    details: { expiresAt: number; scope: unknown }
  ): void {
    this.log({
      id: this.generateId('SESSION_KEY_GENERATED' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'SESSION_KEY_GENERATED' as AuditEventType,
      agentId,
      sessionKeyId,
      details
    })
  }

  logSessionKeyRevoked(
    sessionKeyId: SessionKeyId,
    agentId: AgentId,
    reason: string
  ): void {
    this.log({
      id: this.generateId('SESSION_KEY_REVOKED' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'SESSION_KEY_REVOKED' as AuditEventType,
      agentId,
      sessionKeyId,
      reason,
      details: { revokedAt: Date.now() }
    })
  }

  // ===========================================
  // Permission Events
  // ===========================================
  logPermissionGranted(
    permissionId: PermissionId,
    agentId: AgentId,
    details: {
      target: string
      asset: string
      maxAmount: string
      expiresAt: number
      sessionKeyId: SessionKeyId
    }
  ): void {
    this.log({
      id: this.generateId('PERMISSION_GRANTED' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'PERMISSION_GRANTED' as AuditEventType,
      agentId,
      permissionId,
      details
    })
  }

  logPermissionRevoked(
    permissionId: PermissionId,
    agentId: AgentId,
    reason: string,
    metricsSnapshot?: PerformanceMetrics
  ): void {
    this.log({
      id: this.generateId('PERMISSION_REVOKED' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'PERMISSION_REVOKED' as AuditEventType,
      agentId,
      permissionId,
      reason,
      metricsSnapshot,
      details: { revokedAt: Date.now() }
    })
  }

  logPermissionExtended(
    permissionId: PermissionId,
    agentId: AgentId,
    details: { newExpiresAt: number; previousExpiresAt: number },
    metricsSnapshot: PerformanceMetrics
  ): void {
    this.log({
      id: this.generateId('PERMISSION_EXTENDED' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'PERMISSION_EXTENDED' as AuditEventType,
      agentId,
      permissionId,
      metricsSnapshot,
      details
    })
  }

  logPermissionDowngraded(
    permissionId: PermissionId,
    agentId: AgentId,
    details: { newMaxAmount: string; previousMaxAmount: string },
    metricsSnapshot: PerformanceMetrics
  ): void {
    this.log({
      id: this.generateId('PERMISSION_DOWNGRADED' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'PERMISSION_DOWNGRADED' as AuditEventType,
      agentId,
      permissionId,
      metricsSnapshot,
      details
    })
  }

  // ===========================================
  // Policy Evaluation Events
  // ===========================================
  logPolicyEvaluation(
    agentId: AgentId,
    permissionId: PermissionId,
    decision: PolicyDecision,
    reason: string,
    metricsSnapshot: PerformanceMetrics,
    rules: Array<{
      ruleName: string
      passed: boolean
      actual: number | string
      threshold: number | string
    }>
  ): void {
    this.log({
      id: this.generateId('POLICY_EVALUATION' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'POLICY_EVALUATION' as AuditEventType,
      agentId,
      permissionId,
      decision,
      reason,
      metricsSnapshot,
      details: { rules }
    })
  }

  // ===========================================
  // Envio Events
  // ===========================================
  logEnvioQuery(
    agentId: AgentId,
    success: boolean,
    details: { queryType: string; responseTime: number; error?: string }
  ): void {
    this.log({
      id: this.generateId('ENVIO_QUERY' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'ENVIO_QUERY' as AuditEventType,
      agentId,
      details: { ...details, success }
    })
  }

  logEnvioUnavailable(error: string): void {
    this.log({
      id: this.generateId('ENVIO_UNAVAILABLE' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'ENVIO_UNAVAILABLE' as AuditEventType,
      details: { error, frozenAt: Date.now() }
    })
  }

  // ===========================================
  // Registry Events
  // ===========================================
  logRegistryUnavailable(error: string): void {
    this.log({
      id: this.generateId('REGISTRY_UNAVAILABLE' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'REGISTRY_UNAVAILABLE' as AuditEventType,
      details: { error, detectedAt: Date.now() }
    })
  }

  // ===========================================
  // System Events
  // ===========================================
  logSystemError(error: Error, context: Record<string, unknown>): void {
    this.log({
      id: this.generateId('SYSTEM_ERROR' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'SYSTEM_ERROR' as AuditEventType,
      details: {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
        ...context
      }
    })
  }

  logLoopCycleStart(cycleNumber: number, activeAgentCount: number): void {
    this.log({
      id: this.generateId('LOOP_CYCLE_START' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'LOOP_CYCLE_START' as AuditEventType,
      details: { cycleNumber, activeAgentCount }
    })
  }

  logLoopCycleEnd(
    cycleNumber: number,
    stats: {
      agentsEvaluated: number
      permissionsRevoked: number
      permissionsExtended: number
      permissionsDowngraded: number
      durationMs: number
    }
  ): void {
    this.log({
      id: this.generateId('LOOP_CYCLE_END' as AuditEventType),
      timestamp: Date.now(),
      eventType: 'LOOP_CYCLE_END' as AuditEventType,
      details: { cycleNumber, ...stats }
    })
  }

  // ===========================================
  // Flush & Cleanup
  // ===========================================
  async flush(): Promise<void> {
    return new Promise((resolve) => {
      this.logger.flush()
      setTimeout(resolve, 100)
    })
  }

  getEntryCount(): number {
    return this.entryCount
  }
}

// ===========================================
// Singleton Instance
// ===========================================
let auditLoggerInstance: AuditLogger | null = null

export function initAuditLogger(config: ManagerConfig['audit']): AuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger(config)
  }
  return auditLoggerInstance
}

export function getAuditLogger(): AuditLogger {
  if (!auditLoggerInstance) {
    throw new Error('Audit logger not initialized. Call initAuditLogger first.')
  }
  return auditLoggerInstance
}
