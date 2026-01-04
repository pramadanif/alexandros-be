/**
 * ALEXANDROS Manager Agent - Policy Engine
 * Deterministic rule-based policy evaluation
 * 
 * CRITICAL REQUIREMENTS:
 * - MUST be rule-based
 * - MUST be explainable
 * - MUST be reproducible
 * 
 * FORBIDDEN:
 * - ML models
 * - Heuristics without thresholds
 * - Hidden weights
 * 
 * Each decision MUST:
 * - Log reason
 * - Log metric snapshot
 * - Log timestamp
 */

import {
  PolicyDecision,
  AgentVerificationReason,
  RevocationReason,
  type AgentId,
  type PermissionId,
  type PerformanceMetrics,
  type PolicyThresholds,
  type PolicyEvaluation,
  type PolicyRuleResult,
  type AgentVerificationResult,
  type ManagerConfig
} from './types.js'
import { getAuditLogger } from './auditLog.js'

// ===========================================
// Policy Rule Definitions
// ===========================================
interface PolicyRule {
  name: string
  description: string
  evaluate: (metrics: PerformanceMetrics, thresholds: PolicyThresholds) => PolicyRuleResult
  decision: PolicyDecision
  priority: number // Lower = higher priority
}

// ===========================================
// Core Policy Rules (Deterministic)
// ===========================================
const POLICY_RULES: PolicyRule[] = [
  // RULE 1: Unverified agents must be revoked immediately
  {
    name: 'AGENT_VERIFICATION',
    description: 'Agent must be verified in ERC-8004 registry',
    evaluate: (_metrics, _thresholds) => {
      // This rule is checked separately via registry
      return {
        ruleName: 'AGENT_VERIFICATION',
        passed: true,
        actual: 'verified',
        threshold: 'verified',
        message: 'Agent verification status checked via registry'
      }
    },
    decision: PolicyDecision.REVOKE,
    priority: 0
  },

  // RULE 2: ROI below threshold triggers revocation
  {
    name: 'ROI_THRESHOLD',
    description: 'ROI must not fall below revocation threshold',
    evaluate: (metrics, thresholds) => {
      const passed = metrics.roi >= thresholds.roiRevoke
      return {
        ruleName: 'ROI_THRESHOLD',
        passed,
        actual: metrics.roi,
        threshold: thresholds.roiRevoke,
        message: passed 
          ? `ROI ${(metrics.roi * 100).toFixed(2)}% is above revocation threshold ${(thresholds.roiRevoke * 100).toFixed(2)}%`
          : `ROI ${(metrics.roi * 100).toFixed(2)}% is below revocation threshold ${(thresholds.roiRevoke * 100).toFixed(2)}%`
      }
    },
    decision: PolicyDecision.REVOKE,
    priority: 1
  },

  // RULE 3: Drawdown exceeds maximum
  {
    name: 'DRAWDOWN_LIMIT',
    description: 'Drawdown must not exceed maximum threshold',
    evaluate: (metrics, thresholds) => {
      const passed = metrics.drawdown <= thresholds.drawdownMax
      return {
        ruleName: 'DRAWDOWN_LIMIT',
        passed,
        actual: metrics.drawdown,
        threshold: thresholds.drawdownMax,
        message: passed
          ? `Drawdown ${(metrics.drawdown * 100).toFixed(2)}% is within limit ${(thresholds.drawdownMax * 100).toFixed(2)}%`
          : `Drawdown ${(metrics.drawdown * 100).toFixed(2)}% exceeds maximum ${(thresholds.drawdownMax * 100).toFixed(2)}%`
      }
    },
    decision: PolicyDecision.REVOKE,
    priority: 2
  },

  // RULE 4: Success rate too low triggers downgrade
  {
    name: 'SUCCESS_RATE_MIN',
    description: 'Success rate must meet minimum threshold',
    evaluate: (metrics, thresholds) => {
      const passed = metrics.successRate >= thresholds.successRateMin
      return {
        ruleName: 'SUCCESS_RATE_MIN',
        passed,
        actual: metrics.successRate,
        threshold: thresholds.successRateMin,
        message: passed
          ? `Success rate ${(metrics.successRate * 100).toFixed(2)}% meets minimum ${(thresholds.successRateMin * 100).toFixed(2)}%`
          : `Success rate ${(metrics.successRate * 100).toFixed(2)}% below minimum ${(thresholds.successRateMin * 100).toFixed(2)}%`
      }
    },
    decision: PolicyDecision.DOWNGRADE,
    priority: 3
  },

  // RULE 5: Gas efficiency too low triggers downgrade
  {
    name: 'GAS_EFFICIENCY_MIN',
    description: 'Gas efficiency must meet minimum threshold',
    evaluate: (metrics, thresholds) => {
      const passed = metrics.gasEfficiency >= thresholds.gasEfficiencyMin
      return {
        ruleName: 'GAS_EFFICIENCY_MIN',
        passed,
        actual: metrics.gasEfficiency,
        threshold: thresholds.gasEfficiencyMin,
        message: passed
          ? `Gas efficiency ${(metrics.gasEfficiency * 100).toFixed(2)}% meets minimum ${(thresholds.gasEfficiencyMin * 100).toFixed(2)}%`
          : `Gas efficiency ${(metrics.gasEfficiency * 100).toFixed(2)}% below minimum ${(thresholds.gasEfficiencyMin * 100).toFixed(2)}%`
      }
    },
    decision: PolicyDecision.DOWNGRADE,
    priority: 4
  },

  // RULE 6: Inactivity triggers revocation
  {
    name: 'INACTIVITY_LIMIT',
    description: 'Agent must show activity within threshold',
    evaluate: (metrics, thresholds) => {
      const now = Math.floor(Date.now() / 1000)
      const inactivitySeconds = now - metrics.lastExecutionAt
      const passed = inactivitySeconds <= thresholds.maxInactivitySeconds
      return {
        ruleName: 'INACTIVITY_LIMIT',
        passed,
        actual: inactivitySeconds,
        threshold: thresholds.maxInactivitySeconds,
        message: passed
          ? `Last activity ${inactivitySeconds}s ago, within limit of ${thresholds.maxInactivitySeconds}s`
          : `Last activity ${inactivitySeconds}s ago, exceeds limit of ${thresholds.maxInactivitySeconds}s`
      }
    },
    decision: PolicyDecision.REVOKE,
    priority: 5
  },

  // RULE 7: High ROI allows extension
  {
    name: 'ROI_EXTENSION',
    description: 'High ROI may qualify for permission extension',
    evaluate: (metrics, thresholds) => {
      const passed = metrics.roi >= thresholds.roiExtend
      return {
        ruleName: 'ROI_EXTENSION',
        passed,
        actual: metrics.roi,
        threshold: thresholds.roiExtend,
        message: passed
          ? `ROI ${(metrics.roi * 100).toFixed(2)}% qualifies for extension (threshold: ${(thresholds.roiExtend * 100).toFixed(2)}%)`
          : `ROI ${(metrics.roi * 100).toFixed(2)}% does not qualify for extension (threshold: ${(thresholds.roiExtend * 100).toFixed(2)}%)`
      }
    },
    decision: PolicyDecision.EXTEND,
    priority: 10
  }
]

// ===========================================
// Policy Engine
// ===========================================
export class PolicyEngine {
  private thresholds: PolicyThresholds
  private rules: PolicyRule[]

  constructor(config: ManagerConfig) {
    this.thresholds = config.policy
    this.rules = [...POLICY_RULES].sort((a, b) => a.priority - b.priority)
  }

  // ===========================================
  // Main Evaluation Method
  // ===========================================
  evaluateAgent(
    agentId: AgentId,
    permissionId: PermissionId,
    metrics: PerformanceMetrics,
    verificationResult: AgentVerificationResult
  ): PolicyEvaluation {
    const audit = getAuditLogger()
    const timestamp = Date.now()
    const ruleResults: PolicyRuleResult[] = []
    let finalDecision: PolicyDecision = PolicyDecision.MAINTAIN
    let finalReason = 'All policy rules passed'

    // PRIORITY CHECK: Verification status
    if (!verificationResult.verified) {
      const verificationRule: PolicyRuleResult = {
        ruleName: 'AGENT_VERIFICATION',
        passed: false,
        actual: verificationResult.reason,
        threshold: AgentVerificationReason.VERIFIED,
        message: `Agent verification failed: ${verificationResult.reason}`
      }
      ruleResults.push(verificationRule)
      finalDecision = PolicyDecision.REVOKE
      finalReason = `Agent verification failed: ${verificationResult.reason}`

      // Log and return early
      const evaluation: PolicyEvaluation = {
        agentId,
        permissionId,
        decision: finalDecision,
        reason: finalReason,
        metrics,
        thresholds: this.thresholds,
        evaluatedAt: timestamp,
        rules: ruleResults
      }

      audit.logPolicyEvaluation(
        agentId,
        permissionId,
        finalDecision,
        finalReason,
        metrics,
        ruleResults
      )

      return evaluation
    }

    // Evaluate all rules
    for (const rule of this.rules) {
      if (rule.name === 'AGENT_VERIFICATION') {
        // Already checked above
        continue
      }

      const result = rule.evaluate(metrics, this.thresholds)
      ruleResults.push(result)

      // Determine decision based on rule priority
      if (!result.passed) {
        // Higher priority failing rules take precedence
        if (rule.decision === PolicyDecision.REVOKE && finalDecision !== PolicyDecision.REVOKE) {
          finalDecision = PolicyDecision.REVOKE
          finalReason = result.message
        } else if (rule.decision === PolicyDecision.DOWNGRADE && finalDecision === PolicyDecision.MAINTAIN) {
          finalDecision = PolicyDecision.DOWNGRADE
          finalReason = result.message
        }
      } else if (result.passed && rule.decision === PolicyDecision.EXTEND && finalDecision === PolicyDecision.MAINTAIN) {
        // Only extend if no negative decisions
        finalDecision = PolicyDecision.EXTEND
        finalReason = result.message
      }
    }

    const evaluation: PolicyEvaluation = {
      agentId,
      permissionId,
      decision: finalDecision,
      reason: finalReason,
      metrics,
      thresholds: this.thresholds,
      evaluatedAt: timestamp,
      rules: ruleResults
    }

    // Log evaluation
    audit.logPolicyEvaluation(
      agentId,
      permissionId,
      finalDecision,
      finalReason,
      metrics,
      ruleResults
    )

    return evaluation
  }

  // ===========================================
  // Map Policy Decision to Revocation Reason
  // ===========================================
  getRevocationReason(evaluation: PolicyEvaluation): RevocationReason {
    // Find the failing rule with highest priority
    for (const rule of evaluation.rules) {
      if (!rule.passed) {
        switch (rule.ruleName) {
          case 'AGENT_VERIFICATION':
            return RevocationReason.AGENT_BANNED
          case 'ROI_THRESHOLD':
            return RevocationReason.ROI_THRESHOLD
          case 'DRAWDOWN_LIMIT':
            return RevocationReason.POLICY_VIOLATION
          case 'SUCCESS_RATE_MIN':
            return RevocationReason.SUCCESS_RATE_LOW
          case 'GAS_EFFICIENCY_MIN':
            return RevocationReason.GAS_INEFFICIENCY
          case 'INACTIVITY_LIMIT':
            return RevocationReason.INACTIVITY
        }
      }
    }
    return RevocationReason.POLICY_VIOLATION
  }

  // ===========================================
  // Update Thresholds at Runtime
  // ===========================================
  updateThresholds(newThresholds: Partial<PolicyThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds }
  }

  // ===========================================
  // Get Current Thresholds (for transparency)
  // ===========================================
  getThresholds(): PolicyThresholds {
    return { ...this.thresholds }
  }

  // ===========================================
  // Explain Decision (Human Readable)
  // ===========================================
  explainDecision(evaluation: PolicyEvaluation): string {
    const lines: string[] = [
      `Policy Evaluation for Agent ${evaluation.agentId}`,
      `Permission: ${evaluation.permissionId}`,
      `Decision: ${evaluation.decision}`,
      `Reason: ${evaluation.reason}`,
      `Evaluated at: ${new Date(evaluation.evaluatedAt).toISOString()}`,
      '',
      'Rule Results:',
    ]

    for (const rule of evaluation.rules) {
      const status = rule.passed ? '✓' : '✗'
      lines.push(`  ${status} ${rule.ruleName}: ${rule.message}`)
      lines.push(`      Actual: ${rule.actual} | Threshold: ${rule.threshold}`)
    }

    lines.push('', 'Metrics Snapshot:')
    lines.push(`  ROI: ${(evaluation.metrics.roi * 100).toFixed(2)}%`)
    lines.push(`  Drawdown: ${(evaluation.metrics.drawdown * 100).toFixed(2)}%`)
    lines.push(`  Gas Efficiency: ${(evaluation.metrics.gasEfficiency * 100).toFixed(2)}%`)
    lines.push(`  Success Rate: ${(evaluation.metrics.successRate * 100).toFixed(2)}%`)
    lines.push(`  Execution Count: ${evaluation.metrics.executionCount}`)

    return lines.join('\n')
  }

  // ===========================================
  // Validate Rule Configuration
  // ===========================================
  validateConfiguration(): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (this.thresholds.roiRevoke >= this.thresholds.roiExtend) {
      errors.push('ROI revoke threshold must be less than extend threshold')
    }

    if (this.thresholds.gasEfficiencyMin < 0 || this.thresholds.gasEfficiencyMin > 1) {
      errors.push('Gas efficiency minimum must be between 0 and 1')
    }

    if (this.thresholds.successRateMin < 0 || this.thresholds.successRateMin > 1) {
      errors.push('Success rate minimum must be between 0 and 1')
    }

    if (this.thresholds.maxInactivitySeconds < 3600) {
      errors.push('Max inactivity must be at least 1 hour (3600 seconds)')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }
}

// ===========================================
// Singleton Instance
// ===========================================
let policyEngineInstance: PolicyEngine | null = null

export function initPolicyEngine(config: ManagerConfig): PolicyEngine {
  if (!policyEngineInstance) {
    policyEngineInstance = new PolicyEngine(config)
  }
  return policyEngineInstance
}

export function getPolicyEngine(): PolicyEngine {
  if (!policyEngineInstance) {
    throw new Error('PolicyEngine not initialized. Call initPolicyEngine first.')
  }
  return policyEngineInstance
}
