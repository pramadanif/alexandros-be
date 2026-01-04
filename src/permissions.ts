/**
 * ALEXANDROS Manager Agent - EIP-7702 Permission Orchestration
 * Handles granting, revoking, and modifying permissions
 * 
 * Root Permission: User → Manager Agent
 * Leaf Permission: Manager → Sub-Agent
 * 
 * Backend MUST:
 * - Respect allowance caps
 * - Respect scope boundaries
 * - Expose revocation path
 * - Bind permission to session key
 * - Enforce single-purpose execution
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  parseAbi
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, sepolia } from 'viem/chains'
import type {
  Permission,
  PermissionId,
  PermissionGrant,
  PermissionStatus,
  RevocationReason,
  AgentId,
  PerformanceMetrics,
  ManagerConfig
} from './types.js'
import { getAuditLogger } from './auditLog.js'
import { getSessionKeyManager } from './sessionKeys.js'

// ===========================================
// Permission Manager ABI (EIP-7702)
// ===========================================
const PERMISSION_MANAGER_ABI = parseAbi([
  'function grantPermission(address grantee, address target, bytes4 selector, address asset, uint256 maxAmount, uint256 expiresAt, bytes32 sessionKeyHash) external returns (bytes32 permissionId)',
  'function revokePermission(bytes32 permissionId, string reason) external',
  'function extendPermission(bytes32 permissionId, uint256 newExpiresAt) external',
  'function downgradePermission(bytes32 permissionId, uint256 newMaxAmount) external',
  'function getPermission(bytes32 permissionId) external view returns (address grantee, address target, bytes4 selector, address asset, uint256 maxAmount, uint256 usedAmount, uint256 expiresAt, bytes32 sessionKeyHash, bool isRevoked)',
  'function getActivePermissions(address agent) external view returns (bytes32[])',
  'function isPermissionValid(bytes32 permissionId) external view returns (bool)',
  'event PermissionGranted(bytes32 indexed permissionId, address indexed grantor, address indexed grantee, address target, uint256 expiresAt)',
  'event PermissionRevoked(bytes32 indexed permissionId, address indexed grantor, string reason)',
  'event PermissionExtended(bytes32 indexed permissionId, uint256 newExpiresAt)',
  'event PermissionDowngraded(bytes32 indexed permissionId, uint256 newMaxAmount)'
])

// ===========================================
// Permission Orchestrator Service
// ===========================================
export class PermissionOrchestrator {
  private publicClient: ReturnType<typeof createPublicClient>
  private walletClient: ReturnType<typeof createWalletClient>
  private permissionManagerAddress: Address
  private activePermissions: Map<PermissionId, Permission> = new Map()
  private permissionsByAgent: Map<AgentId, Set<PermissionId>> = new Map()

  constructor(config: ManagerConfig) {
    const chain = config.chainId === 1 ? mainnet : sepolia
    const account = privateKeyToAccount(config.managerAgent.privateKey)

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl)
    })

    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl)
    })

    this.permissionManagerAddress = config.contracts.eip7702PermissionManager
  }

  // ===========================================
  // Grant Permission (Core Method)
  // ===========================================
  async grantPermission(grant: PermissionGrant): Promise<Permission | null> {
    const audit = getAuditLogger()
    const sessionKeyManager = getSessionKeyManager()
    const timestamp = Date.now()

    // Get session key hash
    const sessionKeyHash = sessionKeyManager.getKeyHash(grant.sessionKeyId)
    if (!sessionKeyHash) {
      audit.logSystemError(
        new Error('Session key not found or invalid'),
        { sessionKeyId: grant.sessionKeyId, agentId: grant.grantee }
      )
      return null
    }

    const expiresAt = Math.floor((timestamp + grant.duration * 1000) / 1000)

    try {
      // Prepare transaction
      const { request } = await this.publicClient.simulateContract({
        address: this.permissionManagerAddress,
        abi: PERMISSION_MANAGER_ABI,
        functionName: 'grantPermission',
        args: [
          grant.grantee as Address,
          grant.target,
          grant.selector,
          grant.asset,
          grant.maxAmount,
          BigInt(expiresAt),
          sessionKeyHash
        ],
        account: this.walletClient.account
      })

      // Execute transaction
      const txHash = await this.walletClient.writeContract(request)
      
      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted')
      }

      // Extract permission ID from logs
      const permissionId = this.extractPermissionIdFromLogs(receipt.logs)
      
      if (!permissionId) {
        throw new Error('Failed to extract permission ID from logs')
      }

      // Create permission object
      const permission: Permission = {
        id: permissionId,
        grantor: this.walletClient.account!.address,
        grantee: grant.grantee,
        target: grant.target,
        selector: grant.selector,
        asset: grant.asset,
        maxAmount: grant.maxAmount,
        usedAmount: 0n,
        expiresAt,
        sessionKeyHash,
        status: 'ACTIVE' as PermissionStatus,
        createdAt: timestamp
      }

      // Track permission
      this.activePermissions.set(permissionId, permission)
      if (!this.permissionsByAgent.has(grant.grantee)) {
        this.permissionsByAgent.set(grant.grantee, new Set())
      }
      this.permissionsByAgent.get(grant.grantee)!.add(permissionId)

      // Log grant
      audit.logPermissionGranted(permissionId, grant.grantee, {
        target: grant.target,
        asset: grant.asset,
        maxAmount: grant.maxAmount.toString(),
        expiresAt,
        sessionKeyId: grant.sessionKeyId
      })

      return permission
    } catch (error) {
      audit.logSystemError(
        error instanceof Error ? error : new Error('Unknown error'),
        { operation: 'grantPermission', grant }
      )
      return null
    }
  }

  // ===========================================
  // Revoke Permission
  // ===========================================
  async revokePermission(
    permissionId: PermissionId,
    reason: RevocationReason,
    metricsSnapshot?: PerformanceMetrics
  ): Promise<boolean> {
    const audit = getAuditLogger()
    const sessionKeyManager = getSessionKeyManager()

    const permission = this.activePermissions.get(permissionId)
    if (!permission) {
      return false
    }

    try {
      // Execute revocation on-chain
      const { request } = await this.publicClient.simulateContract({
        address: this.permissionManagerAddress,
        abi: PERMISSION_MANAGER_ABI,
        functionName: 'revokePermission',
        args: [permissionId as Hex, reason],
        account: this.walletClient.account
      })

      const txHash = await this.walletClient.writeContract(request)
      await this.publicClient.waitForTransactionReceipt({ hash: txHash })

      // Update local state
      permission.status = 'REVOKED' as PermissionStatus
      permission.revokedAt = Date.now()
      permission.revokedReason = reason

      // Revoke associated session keys
      const agentKeys = sessionKeyManager.getActiveKeysForAgent(permission.grantee)
      for (const key of agentKeys) {
        sessionKeyManager.revokeKey(key.id, `Permission ${permissionId} revoked: ${reason}`)
      }

      // Log revocation
      audit.logPermissionRevoked(permissionId, permission.grantee, reason, metricsSnapshot)

      return true
    } catch (error) {
      audit.logSystemError(
        error instanceof Error ? error : new Error('Unknown error'),
        { operation: 'revokePermission', permissionId, reason }
      )
      return false
    }
  }

  // ===========================================
  // Extend Permission
  // ===========================================
  async extendPermission(
    permissionId: PermissionId,
    additionalDuration: number,
    metricsSnapshot: PerformanceMetrics
  ): Promise<boolean> {
    const audit = getAuditLogger()

    const permission = this.activePermissions.get(permissionId)
    if (!permission || permission.status !== 'ACTIVE') {
      return false
    }

    const newExpiresAt = Math.floor(Date.now() / 1000) + additionalDuration
    const previousExpiresAt = permission.expiresAt

    try {
      const { request } = await this.publicClient.simulateContract({
        address: this.permissionManagerAddress,
        abi: PERMISSION_MANAGER_ABI,
        functionName: 'extendPermission',
        args: [permissionId as Hex, BigInt(newExpiresAt)],
        account: this.walletClient.account
      })

      const txHash = await this.walletClient.writeContract(request)
      await this.publicClient.waitForTransactionReceipt({ hash: txHash })

      // Update local state
      permission.expiresAt = newExpiresAt

      // Log extension
      audit.logPermissionExtended(
        permissionId,
        permission.grantee,
        { newExpiresAt, previousExpiresAt },
        metricsSnapshot
      )

      return true
    } catch (error) {
      audit.logSystemError(
        error instanceof Error ? error : new Error('Unknown error'),
        { operation: 'extendPermission', permissionId, additionalDuration }
      )
      return false
    }
  }

  // ===========================================
  // Downgrade Permission (Reduce Amount)
  // ===========================================
  async downgradePermission(
    permissionId: PermissionId,
    newMaxAmount: bigint,
    metricsSnapshot: PerformanceMetrics
  ): Promise<boolean> {
    const audit = getAuditLogger()

    const permission = this.activePermissions.get(permissionId)
    if (!permission || permission.status !== 'ACTIVE') {
      return false
    }

    const previousMaxAmount = permission.maxAmount

    try {
      const { request } = await this.publicClient.simulateContract({
        address: this.permissionManagerAddress,
        abi: PERMISSION_MANAGER_ABI,
        functionName: 'downgradePermission',
        args: [permissionId as Hex, newMaxAmount],
        account: this.walletClient.account
      })

      const txHash = await this.walletClient.writeContract(request)
      await this.publicClient.waitForTransactionReceipt({ hash: txHash })

      // Update local state
      permission.maxAmount = newMaxAmount

      // Log downgrade
      audit.logPermissionDowngraded(
        permissionId,
        permission.grantee,
        { 
          newMaxAmount: newMaxAmount.toString(), 
          previousMaxAmount: previousMaxAmount.toString() 
        },
        metricsSnapshot
      )

      return true
    } catch (error) {
      audit.logSystemError(
        error instanceof Error ? error : new Error('Unknown error'),
        { operation: 'downgradePermission', permissionId, newMaxAmount: newMaxAmount.toString() }
      )
      return false
    }
  }

  // ===========================================
  // Get Active Permissions for Agent
  // ===========================================
  async getActivePermissionsForAgent(agentId: AgentId): Promise<Permission[]> {
    const permissionIds = this.permissionsByAgent.get(agentId)
    if (!permissionIds) {
      return []
    }

    const permissions: Permission[] = []
    for (const id of permissionIds) {
      const permission = this.activePermissions.get(id)
      if (permission && permission.status === 'ACTIVE') {
        permissions.push(permission)
      }
    }

    return permissions
  }

  // ===========================================
  // Sync Permission State from Chain
  // ===========================================
  async syncPermissionState(permissionId: PermissionId): Promise<Permission | null> {
    try {
      const result = await this.publicClient.readContract({
        address: this.permissionManagerAddress,
        abi: PERMISSION_MANAGER_ABI,
        functionName: 'getPermission',
        args: [permissionId as Hex]
      }) as [Address, Address, Hex, Address, bigint, bigint, bigint, Hex, boolean]

      const [grantee, target, selector, asset, maxAmount, usedAmount, expiresAt, sessionKeyHash, isRevoked] = result

      const existing = this.activePermissions.get(permissionId)
      
      const permission: Permission = {
        id: permissionId,
        grantor: existing?.grantor || this.walletClient.account!.address,
        grantee: grantee as AgentId,
        target,
        selector,
        asset,
        maxAmount,
        usedAmount,
        expiresAt: Number(expiresAt),
        sessionKeyHash,
        status: isRevoked 
          ? 'REVOKED' as PermissionStatus 
          : Number(expiresAt) < Math.floor(Date.now() / 1000) 
            ? 'EXPIRED' as PermissionStatus 
            : 'ACTIVE' as PermissionStatus,
        createdAt: existing?.createdAt || Date.now()
      }

      this.activePermissions.set(permissionId, permission)
      return permission
    } catch {
      return null
    }
  }

  // ===========================================
  // Batch Revoke for Agent
  // ===========================================
  async revokeAllForAgent(
    agentId: AgentId,
    reason: RevocationReason,
    metricsSnapshot?: PerformanceMetrics
  ): Promise<number> {
    const permissions = await this.getActivePermissionsForAgent(agentId)
    let revokedCount = 0

    for (const permission of permissions) {
      const success = await this.revokePermission(permission.id, reason, metricsSnapshot)
      if (success) {
        revokedCount++
      }
    }

    return revokedCount
  }

  // ===========================================
  // Helper: Extract Permission ID from Logs
  // ===========================================
  private extractPermissionIdFromLogs(logs: readonly { topics: readonly Hex[]; data: Hex }[]): PermissionId | null {
    for (const log of logs) {
      // Permission ID is typically the first indexed parameter
      if (log.topics.length > 1) {
        return log.topics[1] as PermissionId
      }
    }

    return null
  }

  // ===========================================
  // Get Statistics
  // ===========================================
  getStats(): PermissionStats {
    let activeCount = 0
    let revokedCount = 0
    let expiredCount = 0

    for (const permission of this.activePermissions.values()) {
      switch (permission.status) {
        case 'ACTIVE':
          activeCount++
          break
        case 'REVOKED':
          revokedCount++
          break
        case 'EXPIRED':
          expiredCount++
          break
      }
    }

    return {
      activeCount,
      revokedCount,
      expiredCount,
      totalTracked: this.activePermissions.size,
      agentsWithPermissions: this.permissionsByAgent.size
    }
  }
}

// ===========================================
// Internal Types
// ===========================================
interface PermissionStats {
  activeCount: number
  revokedCount: number
  expiredCount: number
  totalTracked: number
  agentsWithPermissions: number
}

// ===========================================
// Singleton Instance
// ===========================================
let permissionOrchestratorInstance: PermissionOrchestrator | null = null

export function initPermissionOrchestrator(config: ManagerConfig): PermissionOrchestrator {
  if (!permissionOrchestratorInstance) {
    permissionOrchestratorInstance = new PermissionOrchestrator(config)
  }
  return permissionOrchestratorInstance
}

export function getPermissionOrchestrator(): PermissionOrchestrator {
  if (!permissionOrchestratorInstance) {
    throw new Error('PermissionOrchestrator not initialized. Call initPermissionOrchestrator first.')
  }
  return permissionOrchestratorInstance
}
