/**
 * ALEXANDROS Manager Agent - Configuration
 * Loads and validates configuration from environment
 */

import { z } from 'zod'
import type { ManagerConfig, PolicyThresholds } from './types.js'
import type { Address, Hex } from 'viem'

// ===========================================
// Configuration Schema (Zod Validation)
// ===========================================
const configSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  rpcUrl: z.string().url(),
  envioEndpoint: z.string().url(),
  envioApiKey: z.string().optional(),
  contracts: z.object({
    erc8004Registry: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    eip7702PermissionManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    alexandrosCore: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
  }),
  managerAgent: z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  }),
  execution: z.object({
    intervalMs: z.coerce.number().int().min(5000).max(300000),
    maxAgentsPerCycle: z.coerce.number().int().min(1).max(1000),
    loopTimeoutMs: z.coerce.number().int().min(10000).max(600000)
  }),
  policy: z.object({
    roiRevoke: z.coerce.number().max(0),
    roiExtend: z.coerce.number().min(0),
    gasEfficiencyMin: z.coerce.number().min(0).max(1),
    successRateMin: z.coerce.number().min(0).max(1),
    maxInactivitySeconds: z.coerce.number().int().positive(),
    drawdownMax: z.coerce.number().min(0).max(1)
  }),
  safety: z.object({
    envioUnavailableFreeze: z.coerce.boolean(),
    registryUnreachableRevoke: z.coerce.boolean(),
    maxPermissionDurationSeconds: z.coerce.number().int().positive()
  }),
  audit: z.object({
    logPath: z.string(),
    maxSize: z.coerce.number().int().positive(),
    maxFiles: z.coerce.number().int().positive()
  })
})

// ===========================================
// Load Configuration from Environment
// ===========================================
export function loadConfig(): ManagerConfig {
  const rawConfig = {
    chainId: process.env.CHAIN_ID || '1',
    rpcUrl: process.env.RPC_URL,
    envioEndpoint: process.env.ENVIO_GRAPHQL_ENDPOINT,
    envioApiKey: process.env.ENVIO_API_KEY,
    contracts: {
      erc8004Registry: process.env.ERC8004_REGISTRY_ADDRESS,
      eip7702PermissionManager: process.env.EIP7702_PERMISSION_MANAGER_ADDRESS,
      alexandrosCore: process.env.ALEXANDROS_CORE_ADDRESS
    },
    managerAgent: {
      address: process.env.MANAGER_AGENT_ADDRESS,
      privateKey: process.env.MANAGER_PRIVATE_KEY
    },
    execution: {
      intervalMs: process.env.EVALUATION_INTERVAL_MS || '30000',
      maxAgentsPerCycle: process.env.MAX_AGENTS_PER_CYCLE || '50',
      loopTimeoutMs: process.env.LOOP_TIMEOUT_MS || '60000'
    },
    policy: {
      roiRevoke: process.env.ROI_REVOKE_THRESHOLD || '-0.03',
      roiExtend: process.env.ROI_EXTEND_THRESHOLD || '0.05',
      gasEfficiencyMin: process.env.GAS_EFFICIENCY_MIN || '0.7',
      successRateMin: process.env.SUCCESS_RATE_MIN || '0.9',
      maxInactivitySeconds: process.env.MAX_INACTIVITY_SECONDS || '604800',
      drawdownMax: process.env.DRAWDOWN_MAX || '0.15'
    },
    safety: {
      envioUnavailableFreeze: process.env.ENVIO_UNAVAILABLE_FREEZE || 'true',
      registryUnreachableRevoke: process.env.REGISTRY_UNREACHABLE_REVOKE || 'true',
      maxPermissionDurationSeconds: process.env.MAX_PERMISSION_DURATION_SECONDS || '2592000'
    },
    audit: {
      logPath: process.env.AUDIT_LOG_PATH || './logs/audit.log',
      maxSize: process.env.AUDIT_LOG_MAX_SIZE || '10485760',
      maxFiles: process.env.AUDIT_LOG_MAX_FILES || '10'
    }
  }

  const result = configSchema.safeParse(rawConfig)
  
  if (!result.success) {
    const errors = result.error.flatten()
    throw new Error(`Configuration validation failed:\n${JSON.stringify(errors, null, 2)}`)
  }

  // Cast validated config to proper types
  return {
    ...result.data,
    contracts: {
      erc8004Registry: result.data.contracts.erc8004Registry as Address,
      eip7702PermissionManager: result.data.contracts.eip7702PermissionManager as Address,
      alexandrosCore: result.data.contracts.alexandrosCore as Address
    },
    managerAgent: {
      address: result.data.managerAgent.address as Address,
      privateKey: result.data.managerAgent.privateKey as Hex
    }
  } as ManagerConfig
}

// ===========================================
// Get Default Policy Thresholds
// ===========================================
export function getDefaultPolicyThresholds(): PolicyThresholds {
  return {
    roiRevoke: -0.03,        // -3% ROI triggers revocation
    roiExtend: 0.05,         // +5% ROI allows extension
    gasEfficiencyMin: 0.7,   // 70% minimum gas efficiency
    successRateMin: 0.9,     // 90% minimum success rate
    maxInactivitySeconds: 604800, // 7 days max inactivity
    drawdownMax: 0.15        // 15% max drawdown
  }
}

// ===========================================
// Validate Config at Runtime
// ===========================================
export function validateConfig(config: ManagerConfig): void {
  // Validate policy thresholds are sensible
  if (config.policy.roiRevoke >= config.policy.roiExtend) {
    throw new Error('ROI revoke threshold must be less than extend threshold')
  }

  // Validate execution timing
  if (config.execution.loopTimeoutMs <= config.execution.intervalMs) {
    throw new Error('Loop timeout must be greater than evaluation interval')
  }

  // Validate safety bounds
  if (config.safety.maxPermissionDurationSeconds < 3600) {
    throw new Error('Max permission duration must be at least 1 hour')
  }
}
