/**
 * ALEXANDROS Manager Agent - Module Index
 * Re-exports all public modules for convenience
 */

// Types
export * from './types.js'

// Configuration
export { loadConfig, validateConfig, getDefaultPolicyThresholds } from './config.js'

// Audit Logger
export { initAuditLogger, getAuditLogger, AuditLogger } from './auditLog.js'

// ERC-8004 Registry
export { initRegistry, getRegistry, AgentRegistry } from './registry.js'

// P256 Session Keys
export { initSessionKeyManager, getSessionKeyManager, SessionKeyManager } from './sessionKeys.js'

// Envio SDK
export { initEnvioSDK, getEnvioSDK, EnvioSDK } from './enviosdk.js'

// Permission Orchestrator
export { initPermissionOrchestrator, getPermissionOrchestrator, PermissionOrchestrator } from './permissions.js'

// Policy Engine
export { initPolicyEngine, getPolicyEngine, PolicyEngine } from './policyEngine.js'

// Main Orchestrator
export { ManagerAgentOrchestrator } from './main.js'

// API Types
export * from './api.js'
