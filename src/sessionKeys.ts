/**
 * ALEXANDROS Manager Agent - P256 Session Key Management
 * Ephemeral session keys for time-bound, scoped agent permissions
 * 
 * CRITICAL SECURITY RULES:
 * - Keys are P256 only
 * - Keys are ephemeral (time-bound)
 * - One key per sub-agent per session
 * - Keys are never reused
 * - Keys are never stored in plaintext long-term
 * - Revocation immediately invalidates the key
 */

import { createHash, generateKeyPairSync } from 'crypto'
import type { Hex, Address } from 'viem'
import { toHex, keccak256 } from 'viem'
import type {
  SessionKey,
  SessionKeyId,
  SessionKeyGeneration,
  AgentId,
  ManagerConfig
} from './types.js'
import { getAuditLogger } from './auditLog.js'

// ===========================================
// Session Key Manager
// ===========================================
export class SessionKeyManager {
  // In-memory store for active session keys (never persisted)
  private activeKeys: Map<SessionKeyId, SessionKeyState> = new Map()
  private keysByAgent: Map<AgentId, Set<SessionKeyId>> = new Map()
  private maxPermissionDuration: number

  constructor(config: ManagerConfig) {
    this.maxPermissionDuration = config.safety.maxPermissionDurationSeconds
  }

  // ===========================================
  // Generate New Session Key
  // ===========================================
  async generateSessionKey(params: SessionKeyGeneration): Promise<SessionKey> {
    const audit = getAuditLogger()
    const timestamp = Date.now()

    // Validate duration
    const duration = Math.min(params.duration, this.maxPermissionDuration)
    const expiresAt = timestamp + (duration * 1000)

    // Generate P256 key pair using Node.js crypto
    const keyPair = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    })
    const publicKeyBuffer = keyPair.publicKey as Buffer
    const privateKeyBuffer = keyPair.privateKey as Buffer
    
    // Create session key ID (hash of public key + agent ID + timestamp)
    const idSource = Buffer.concat([
      publicKeyBuffer,
      Buffer.from(params.agentId.slice(2), 'hex'),
      Buffer.from(timestamp.toString())
    ])
    const hash = createHash('sha256').update(idSource).digest()
    const keyId = `sk-${toHex(hash).slice(0, 18)}` as SessionKeyId

    // Create session key object
    const sessionKey: SessionKey = {
      id: keyId,
      publicKey: toHex(publicKeyBuffer) as Hex,
      agentId: params.agentId,
      permissionScope: params.scope,
      createdAt: timestamp,
      expiresAt,
      isRevoked: false
    }

    // Store key state (private key is hashed, not stored raw)
    const keyState: SessionKeyState = {
      sessionKey,
      privateKeyHash: keccak256(toHex(privateKeyBuffer)),
      usageCount: 0
    }

    this.activeKeys.set(keyId, keyState)

    // Track key by agent
    if (!this.keysByAgent.has(params.agentId)) {
      this.keysByAgent.set(params.agentId, new Set())
    }
    this.keysByAgent.get(params.agentId)!.add(keyId)

    // Log generation
    audit.logSessionKeyGenerated(keyId, params.agentId, {
      expiresAt,
      scope: {
        assets: params.scope.assets,
        targets: params.scope.targets,
        selectors: params.scope.selectors
      }
    })

    return sessionKey
  }

  // ===========================================
  // Get Session Key Hash for On-Chain Binding
  // ===========================================
  getKeyHash(keyId: SessionKeyId): Hex | null {
    const keyState = this.activeKeys.get(keyId)
    if (!keyState || keyState.sessionKey.isRevoked) {
      return null
    }

    // Return keccak256 hash of the public key for on-chain storage
    return keccak256(keyState.sessionKey.publicKey)
  }

  // ===========================================
  // Validate Session Key
  // ===========================================
  validateKey(keyId: SessionKeyId): ValidationResult {
    const keyState = this.activeKeys.get(keyId)
    
    if (!keyState) {
      return { valid: false, reason: 'KEY_NOT_FOUND' }
    }

    const { sessionKey } = keyState

    if (sessionKey.isRevoked) {
      return { valid: false, reason: 'KEY_REVOKED' }
    }

    if (Date.now() > sessionKey.expiresAt) {
      // Auto-revoke expired key
      this.revokeKey(keyId, 'EXPIRED')
      return { valid: false, reason: 'KEY_EXPIRED' }
    }

    return { valid: true }
  }

  // ===========================================
  // Revoke Session Key
  // ===========================================
  revokeKey(keyId: SessionKeyId, reason: string): boolean {
    const audit = getAuditLogger()
    const keyState = this.activeKeys.get(keyId)
    
    if (!keyState) {
      return false
    }

    // Mark as revoked
    keyState.sessionKey.isRevoked = true
    keyState.sessionKey.revokedAt = Date.now()

    // Log revocation
    audit.logSessionKeyRevoked(keyId, keyState.sessionKey.agentId, reason)

    // Remove from active tracking after short delay (for audit consistency)
    setTimeout(() => {
      this.activeKeys.delete(keyId)
      const agentKeys = this.keysByAgent.get(keyState.sessionKey.agentId)
      if (agentKeys) {
        agentKeys.delete(keyId)
      }
    }, 5000)

    return true
  }

  // ===========================================
  // Revoke All Keys for Agent
  // ===========================================
  revokeAllForAgent(agentId: AgentId, reason: string): number {
    const agentKeys = this.keysByAgent.get(agentId)
    if (!agentKeys) {
      return 0
    }

    let revokedCount = 0
    for (const keyId of agentKeys) {
      if (this.revokeKey(keyId, reason)) {
        revokedCount++
      }
    }

    return revokedCount
  }

  // ===========================================
  // Get Active Keys for Agent
  // ===========================================
  getActiveKeysForAgent(agentId: AgentId): SessionKey[] {
    const agentKeys = this.keysByAgent.get(agentId)
    if (!agentKeys) {
      return []
    }

    const activeKeys: SessionKey[] = []
    for (const keyId of agentKeys) {
      const keyState = this.activeKeys.get(keyId)
      if (keyState && !keyState.sessionKey.isRevoked) {
        activeKeys.push(keyState.sessionKey)
      }
    }

    return activeKeys
  }

  // ===========================================
  // Check Permission Scope
  // ===========================================
  isWithinScope(
    keyId: SessionKeyId,
    target: Address,
    asset: Address,
    amount: bigint,
    selector: Hex
  ): boolean {
    const keyState = this.activeKeys.get(keyId)
    if (!keyState) {
      return false
    }

    const { permissionScope } = keyState.sessionKey

    // Check target is allowed
    if (permissionScope.targets.length > 0 && !permissionScope.targets.includes(target)) {
      return false
    }

    // Check asset is allowed
    if (permissionScope.assets.length > 0 && !permissionScope.assets.includes(asset)) {
      return false
    }

    // Check amount is within limit
    const maxAmount = permissionScope.maxAmounts[asset]
    if (maxAmount !== undefined && amount > maxAmount) {
      return false
    }

    // Check selector is allowed
    if (permissionScope.selectors.length > 0 && !permissionScope.selectors.includes(selector)) {
      return false
    }

    return true
  }

  // ===========================================
  // Cleanup Expired Keys
  // ===========================================
  cleanupExpiredKeys(): number {
    let cleanedCount = 0
    const now = Date.now()

    for (const [keyId, keyState] of this.activeKeys) {
      if (keyState.sessionKey.expiresAt < now || keyState.sessionKey.isRevoked) {
        this.activeKeys.delete(keyId)
        const agentKeys = this.keysByAgent.get(keyState.sessionKey.agentId)
        if (agentKeys) {
          agentKeys.delete(keyId)
        }
        cleanedCount++
      }
    }

    return cleanedCount
  }

  // ===========================================
  // Get Statistics
  // ===========================================
  getStats(): SessionKeyStats {
    let activeCount = 0
    let revokedCount = 0
    let expiredCount = 0
    const now = Date.now()

    for (const keyState of this.activeKeys.values()) {
      if (keyState.sessionKey.isRevoked) {
        revokedCount++
      } else if (keyState.sessionKey.expiresAt < now) {
        expiredCount++
      } else {
        activeCount++
      }
    }

    return {
      activeCount,
      revokedCount,
      expiredCount,
      totalTracked: this.activeKeys.size,
      agentsWithKeys: this.keysByAgent.size
    }
  }
}

// ===========================================
// Internal Types
// ===========================================
interface SessionKeyState {
  sessionKey: SessionKey
  privateKeyHash: Hex // Never store actual private key
  usageCount: number
}

interface ValidationResult {
  valid: boolean
  reason?: string
}

interface SessionKeyStats {
  activeCount: number
  revokedCount: number
  expiredCount: number
  totalTracked: number
  agentsWithKeys: number
}

// ===========================================
// Singleton Instance
// ===========================================
let sessionKeyManagerInstance: SessionKeyManager | null = null

export function initSessionKeyManager(config: ManagerConfig): SessionKeyManager {
  if (!sessionKeyManagerInstance) {
    sessionKeyManagerInstance = new SessionKeyManager(config)
  }
  return sessionKeyManagerInstance
}

export function getSessionKeyManager(): SessionKeyManager {
  if (!sessionKeyManagerInstance) {
    throw new Error('SessionKeyManager not initialized. Call initSessionKeyManager first.')
  }
  return sessionKeyManagerInstance
}
