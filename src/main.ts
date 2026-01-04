/**
 * ALEXANDROS Manager Agent - Main Orchestrator
 * Lifecycle management and execution loop
 * 
 * CANONICAL EXECUTION LOOP:
 * loop:
 *   for agent in activeAgents:
 *     verify registry status
 *     fetch Envio metrics
 *     evaluate policy
 *     if decision:
 *       grant / extend / revoke permission
 *     log outcome
 * 
 * FAILURE & SAFETY RULES:
 * - If Envio is unavailable → freeze permission changes
 * - If registry is unreachable → revoke new grants
 * - If backend crashes → permissions remain bounded
 * - User kill-switch ALWAYS overrides backend
 */

import 'dotenv/config'
import {
  PolicyDecision,
  RevocationReason,
  type AgentId,
  type AgentState,
  type OrchestratorState,
  type ManagerConfig
} from './types.js'
import { loadConfig, validateConfig } from './config.js'
import { initAuditLogger, getAuditLogger } from './auditLog.js'
import { initRegistry, getRegistry } from './registry.js'
import { initSessionKeyManager } from './sessionKeys.js'
import { initEnvioSDK, getEnvioSDK } from './enviosdk.js'
import { initPermissionOrchestrator, getPermissionOrchestrator } from './permissions.js'
import { initPolicyEngine, getPolicyEngine } from './policyEngine.js'

// ===========================================
// Manager Agent Orchestrator
// ===========================================
class ManagerAgentOrchestrator {
  private config: ManagerConfig
  private state: OrchestratorState
  private loopInterval: NodeJS.Timeout | null = null
  private isProcessingCycle = false

  constructor(config: ManagerConfig) {
    this.config = config
    this.state = {
      isRunning: false,
      lastCycleAt: 0,
      cycleCount: 0,
      activeAgents: new Map(),
      envioAvailable: true,
      registryAvailable: true,
      frozen: false
    }
  }

  // ===========================================
  // Initialize All Services
  // ===========================================
  async initialize(): Promise<void> {
    console.log('[INIT] Initializing ALEXANDROS Manager Agent...')

    // Initialize audit logger first
    initAuditLogger(this.config.audit)
    const audit = getAuditLogger()

    // Initialize all services
    initRegistry(this.config)
    initSessionKeyManager(this.config)
    initEnvioSDK(this.config)
    initPermissionOrchestrator(this.config)
    initPolicyEngine(this.config)

    // Validate policy configuration
    const policy = getPolicyEngine()
    const validation = policy.validateConfiguration()
    if (!validation.valid) {
      throw new Error(`Policy configuration invalid: ${validation.errors.join(', ')}`)
    }

    // Initial health checks
    await this.performHealthChecks()

    console.log('[INIT] Manager Agent initialized successfully')
    audit.logLoopCycleStart(0, 0)
  }

  // ===========================================
  // Start the Execution Loop
  // ===========================================
  start(): void {
    if (this.state.isRunning) {
      console.log('[WARN] Manager Agent already running')
      return
    }

    console.log(`[START] Starting execution loop (interval: ${this.config.execution.intervalMs}ms)`)
    this.state.isRunning = true

    // Execute immediately on start
    this.executeCycle()

    // Schedule recurring execution
    this.loopInterval = setInterval(
      () => this.executeCycle(),
      this.config.execution.intervalMs
    )
  }

  // ===========================================
  // Stop the Execution Loop
  // ===========================================
  stop(): void {
    if (!this.state.isRunning) {
      return
    }

    console.log('[STOP] Stopping execution loop...')
    this.state.isRunning = false

    if (this.loopInterval) {
      clearInterval(this.loopInterval)
      this.loopInterval = null
    }
  }

  // ===========================================
  // Core Execution Cycle (THE CANONICAL LOOP)
  // ===========================================
  private async executeCycle(): Promise<void> {
    // Prevent concurrent cycles
    if (this.isProcessingCycle) {
      console.log('[WARN] Previous cycle still processing, skipping...')
      return
    }

    this.isProcessingCycle = true
    const cycleNumber = ++this.state.cycleCount
    const cycleStartTime = Date.now()

    const audit = getAuditLogger()
    const registry = getRegistry()
    const envio = getEnvioSDK()
    const permissions = getPermissionOrchestrator()
    const policy = getPolicyEngine()

    let agentsEvaluated = 0
    let permissionsRevoked = 0
    let permissionsExtended = 0
    let permissionsDowngraded = 0

    try {
      audit.logLoopCycleStart(cycleNumber, this.state.activeAgents.size)

      // STEP 1: Health Checks
      await this.performHealthChecks()

      // STEP 2: Check if system is frozen
      if (this.state.frozen) {
        console.log(`[CYCLE ${cycleNumber}] System frozen: ${this.state.frozenReason}`)
        return
      }

      // STEP 3: Get active agents to evaluate
      const agentsToEvaluate = this.getAgentsForEvaluation()
      console.log(`[CYCLE ${cycleNumber}] Evaluating ${agentsToEvaluate.length} agents`)

      // STEP 4: Process each agent
      for (const agentState of agentsToEvaluate) {
        const agentId = agentState.agentId

        try {
          // STEP 4.1: Verify registry status
          const verificationResult = await registry.verifyAgent(agentId)

          // STEP 4.2: Fetch Envio metrics
          const envioResult = await envio.queryAgentPerformance(agentId)

          if (!envioResult.success || !envioResult.data) {
            console.log(`[CYCLE ${cycleNumber}] No metrics for agent ${agentId}`)
            continue
          }

          const metrics = envioResult.data

          // STEP 4.3: Evaluate each permission
          for (const permissionId of agentState.activePermissions) {
            const evaluation = policy.evaluateAgent(
              agentId,
              permissionId,
              metrics,
              verificationResult
            )

            // STEP 4.4: Execute decision
            switch (evaluation.decision) {
              case PolicyDecision.REVOKE:
                const revocationReason = policy.getRevocationReason(evaluation)
                const revoked = await permissions.revokePermission(
                  permissionId,
                  revocationReason,
                  metrics
                )
                if (revoked) {
                  permissionsRevoked++
                  console.log(`[CYCLE ${cycleNumber}] Revoked permission ${permissionId}: ${evaluation.reason}`)
                }
                break

              case PolicyDecision.EXTEND:
                const extended = await permissions.extendPermission(
                  permissionId,
                  604800, // Extend by 7 days
                  metrics
                )
                if (extended) {
                  permissionsExtended++
                  console.log(`[CYCLE ${cycleNumber}] Extended permission ${permissionId}`)
                }
                break

              case PolicyDecision.DOWNGRADE:
                // Reduce max amount by 25%
                const currentPermissions = await permissions.getActivePermissionsForAgent(agentId)
                const perm = currentPermissions.find(p => p.id === permissionId)
                if (perm) {
                  const newMaxAmount = (perm.maxAmount * 75n) / 100n
                  const downgraded = await permissions.downgradePermission(
                    permissionId,
                    newMaxAmount,
                    metrics
                  )
                  if (downgraded) {
                    permissionsDowngraded++
                    console.log(`[CYCLE ${cycleNumber}] Downgraded permission ${permissionId}`)
                  }
                }
                break

              case PolicyDecision.MAINTAIN:
                // No action needed
                break
            }
          }

          // Update agent state
          agentState.lastEvaluatedAt = Date.now()
          agentState.lastMetrics = metrics
          agentState.verificationStatus = verificationResult
          agentsEvaluated++

        } catch (error) {
          audit.logSystemError(
            error instanceof Error ? error : new Error('Unknown error'),
            { agentId, cycleNumber }
          )
        }
      }

    } catch (error) {
      audit.logSystemError(
        error instanceof Error ? error : new Error('Unknown error'),
        { cycleNumber, phase: 'cycle_execution' }
      )
    } finally {
      const cycleDuration = Date.now() - cycleStartTime
      this.state.lastCycleAt = Date.now()
      this.isProcessingCycle = false

      audit.logLoopCycleEnd(cycleNumber, {
        agentsEvaluated,
        permissionsRevoked,
        permissionsExtended,
        permissionsDowngraded,
        durationMs: cycleDuration
      })

      console.log(`[CYCLE ${cycleNumber}] Completed in ${cycleDuration}ms - Evaluated: ${agentsEvaluated}, Revoked: ${permissionsRevoked}, Extended: ${permissionsExtended}, Downgraded: ${permissionsDowngraded}`)
    }
  }

  // ===========================================
  // Health Checks
  // ===========================================
  private async performHealthChecks(): Promise<void> {
    const audit = getAuditLogger()
    const registry = getRegistry()
    const envio = getEnvioSDK()

    // Check Envio availability
    const envioHealthy = await envio.checkHealth()
    this.state.envioAvailable = envioHealthy

    if (!envioHealthy && this.config.safety.envioUnavailableFreeze) {
      this.state.frozen = true
      this.state.frozenReason = 'Envio unavailable - freezing permission changes'
      audit.logEnvioUnavailable('Health check failed')
    } else if (envioHealthy && this.state.frozenReason?.includes('Envio')) {
      this.state.frozen = false
      this.state.frozenReason = undefined
    }

    // Check registry availability
    const registryHealthy = await registry.isAvailable()
    this.state.registryAvailable = registryHealthy

    if (!registryHealthy) {
      audit.logRegistryUnavailable('Health check failed')
    }
  }

  // ===========================================
  // Get Agents for Current Evaluation Cycle
  // ===========================================
  private getAgentsForEvaluation(): AgentState[] {
    const agents = Array.from(this.state.activeAgents.values())
    
    // Sort by last evaluated time (oldest first)
    agents.sort((a, b) => a.lastEvaluatedAt - b.lastEvaluatedAt)

    // Limit to max agents per cycle
    return agents.slice(0, this.config.execution.maxAgentsPerCycle)
  }

  // ===========================================
  // Register Agent for Monitoring
  // ===========================================
  registerAgent(agentId: AgentId, permissionIds: string[]): void {
    const agentState: AgentState = {
      agentId,
      verificationStatus: {
        verified: false,
        agent: null,
        reason: 0 as any, // Will be set on first evaluation
        timestamp: Date.now()
      },
      activePermissions: permissionIds as any[],
      sessionKeys: [],
      lastEvaluatedAt: 0
    }

    this.state.activeAgents.set(agentId, agentState)
    console.log(`[REGISTER] Agent ${agentId} registered with ${permissionIds.length} permissions`)
  }

  // ===========================================
  // Unregister Agent
  // ===========================================
  unregisterAgent(agentId: AgentId): void {
    this.state.activeAgents.delete(agentId)
    console.log(`[UNREGISTER] Agent ${agentId} unregistered`)
  }

  // ===========================================
  // Force Revocation (Kill Switch Support)
  // ===========================================
  async forceRevocation(agentId: AgentId, reason: string): Promise<number> {
    const permissions = getPermissionOrchestrator()

    console.log(`[KILL-SWITCH] Force revoking all permissions for agent ${agentId}: ${reason}`)

    const revokedCount = await permissions.revokeAllForAgent(
      agentId,
      RevocationReason.USER_INITIATED
    )

    this.unregisterAgent(agentId)

    return revokedCount
  }

  // ===========================================
  // Get Current State (for monitoring)
  // ===========================================
  getState(): Readonly<OrchestratorState> {
    return { ...this.state }
  }

  // ===========================================
  // Graceful Shutdown
  // ===========================================
  async shutdown(): Promise<void> {
    console.log('[SHUTDOWN] Initiating graceful shutdown...')

    this.stop()

    // Wait for current cycle to complete
    while (this.isProcessingCycle) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Flush audit logs
    const audit = getAuditLogger()
    await audit.flush()

    console.log('[SHUTDOWN] Manager Agent shut down successfully')
  }
}

// ===========================================
// Main Entry Point
// ===========================================
async function main(): Promise<void> {
  console.log('========================================')
  console.log('  ALEXANDROS Manager Agent v1.0.0')
  console.log('  Autonomous Policy Enforcer')
  console.log('========================================')
  console.log()

  try {
    // Load and validate configuration
    const config = loadConfig()
    validateConfig(config)

    // Create orchestrator
    const orchestrator = new ManagerAgentOrchestrator(config)

    // Initialize
    await orchestrator.initialize()

    // Handle shutdown signals
    const shutdown = async () => {
      await orchestrator.shutdown()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    // Start the execution loop
    orchestrator.start()

    console.log()
    console.log('[READY] Manager Agent is now running')
    console.log('[READY] Press Ctrl+C to stop')

  } catch (error) {
    console.error('[FATAL] Failed to start Manager Agent:', error)
    process.exit(1)
  }
}

// Export for external use
export { ManagerAgentOrchestrator }
export type { OrchestratorState }

// Run if main module
main()
