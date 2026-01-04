/**
 * ALEXANDROS Manager Agent - ERC-8004 Agent Registry
 * Handles agent verification against the on-chain registry
 * NO permission may be granted before registry verification succeeds
 */

import { createPublicClient, http, type Address, type Hex, parseAbi } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import {
  AgentVerificationReason,
  AgentStatus,
  StrategyType,
  type AgentId,
  type CodeHash,
  type RegisteredAgent,
  type AgentVerificationResult,
  type ManagerConfig
} from './types.js'
import { getAuditLogger } from './auditLog.js'

// ===========================================
// ERC-8004 Registry ABI
// ===========================================
const ERC8004_ABI = parseAbi([
  'function getAgent(uint256 agentId) external view returns (uint256 id, bytes32 codeHash, uint8 status, bytes32 metadataHash, uint256 lastUpdated, address owner)',
  'function getAgentByAddress(address agentAddress) external view returns (uint256 id, bytes32 codeHash, uint8 status, bytes32 metadataHash, uint256 lastUpdated, address owner)',
  'function isVerified(uint256 agentId) external view returns (bool)',
  'function isVerifiedByAddress(address agentAddress) external view returns (bool)',
  'function isBanned(uint256 agentId) external view returns (bool)',
  'function isBannedByAddress(address agentAddress) external view returns (bool)',
  'function getCodeHash(uint256 agentId) external view returns (bytes32)',
  'function getAgentMetadata(uint256 agentId) external view returns (bytes32 metadataHash, string memory strategyType, uint256 registrationDate)',
  'event AgentRegistered(uint256 indexed agentId, address indexed agentAddress, bytes32 codeHash)',
  'event AgentUpdated(uint256 indexed agentId, bytes32 newCodeHash)',
  'event AgentBanned(uint256 indexed agentId, string reason)'
])

// ===========================================
// Registry Service
// ===========================================
export class AgentRegistry {
  private client: ReturnType<typeof createPublicClient>
  private registryAddress: Address
  private verificationCache: Map<AgentId, { result: AgentVerificationResult; expiresAt: number }> = new Map()
  private cacheValidityMs = 60000 // 1 minute cache

  constructor(config: ManagerConfig) {
    const chain = config.chainId === 1 ? mainnet : sepolia
    
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl)
    })
    
    this.registryAddress = config.contracts.erc8004Registry
  }

  // ===========================================
  // Primary Verification Method
  // ===========================================
  async verifyAgent(agentId: AgentId, expectedCodeHash?: CodeHash): Promise<AgentVerificationResult> {
    const audit = getAuditLogger()
    const timestamp = Date.now()

    // Check cache first
    const cached = this.verificationCache.get(agentId)
    if (cached && cached.expiresAt > timestamp) {
      return cached.result
    }

    try {
      // Fetch agent data from registry
      const agentData = await this.fetchAgentData(agentId)

      if (!agentData) {
        const result: AgentVerificationResult = {
          verified: false,
          agent: null,
          reason: AgentVerificationReason.UNREGISTERED,
          timestamp
        }
        audit.logAgentVerificationFailed(agentId, 'Agent not registered in ERC-8004 registry', {})
        return result
      }

      // Check if banned
      if (agentData.status === AgentStatus.BANNED) {
        const result: AgentVerificationResult = {
          verified: false,
          agent: agentData,
          reason: AgentVerificationReason.BANNED,
          timestamp
        }
        audit.logAgentVerificationFailed(agentId, 'Agent is banned', { status: agentData.status })
        return result
      }

      // Verify code hash if provided
      if (expectedCodeHash && agentData.codeHash !== expectedCodeHash) {
        const result: AgentVerificationResult = {
          verified: false,
          agent: agentData,
          reason: AgentVerificationReason.CODE_HASH_MISMATCH,
          timestamp
        }
        audit.logAgentVerificationFailed(agentId, 'Code hash mismatch', {
          expected: expectedCodeHash,
          actual: agentData.codeHash
        })
        return result
      }

      // Verification passed
      const result: AgentVerificationResult = {
        verified: true,
        agent: agentData,
        reason: AgentVerificationReason.VERIFIED,
        timestamp
      }

      // Cache the result
      this.verificationCache.set(agentId, {
        result,
        expiresAt: timestamp + this.cacheValidityMs
      })

      audit.logAgentVerified(agentId, {
        codeHash: agentData.codeHash,
        strategyType: agentData.strategyType,
        owner: agentData.owner
      })

      return result
    } catch (error) {
      const result: AgentVerificationResult = {
        verified: false,
        agent: null,
        reason: AgentVerificationReason.REGISTRY_UNAVAILABLE,
        timestamp
      }
      
      audit.logRegistryUnavailable(error instanceof Error ? error.message : 'Unknown error')
      audit.logAgentVerificationFailed(agentId, 'Registry unavailable', {
        error: error instanceof Error ? error.message : 'Unknown'
      })
      
      return result
    }
  }

  // ===========================================
  // Fetch Agent Data from Chain
  // ===========================================
  private async fetchAgentData(agentId: AgentId): Promise<RegisteredAgent | null> {
    try {
      // Try to get agent by address
      const result = await this.client.readContract({
        address: this.registryAddress,
        abi: ERC8004_ABI,
        functionName: 'getAgentByAddress',
        args: [agentId as Address]
      }) as [bigint, Hex, number, Hex, bigint, Address]

      const [id, codeHash, status, metadataHash, lastUpdated, owner] = result

      // Agent with id 0 is not registered
      if (id === 0n) {
        return null
      }

      // Fetch additional metadata
      let strategyType: StrategyType = StrategyType.CUSTOM
      let registrationDate = Number(lastUpdated)

      try {
        const metadata = await this.client.readContract({
          address: this.registryAddress,
          abi: ERC8004_ABI,
          functionName: 'getAgentMetadata',
          args: [id]
        }) as [Hex, string, bigint]

        strategyType = this.parseStrategyType(metadata[1])
        registrationDate = Number(metadata[2])
      } catch {
        // Metadata fetch failed, use defaults
      }

      return {
        id: agentId,
        codeHash: codeHash as CodeHash,
        status: this.mapStatus(status),
        metadataHash,
        lastUpdated: Number(lastUpdated),
        owner,
        strategyType,
        registrationDate
      }
    } catch (error) {
      // Re-throw for upstream handling
      throw error
    }
  }

  // ===========================================
  // Batch Verification
  // ===========================================
  async verifyAgents(agentIds: AgentId[]): Promise<Map<AgentId, AgentVerificationResult>> {
    const results = new Map<AgentId, AgentVerificationResult>()
    
    // Verify in parallel with concurrency limit
    const batchSize = 10
    for (let i = 0; i < agentIds.length; i += batchSize) {
      const batch = agentIds.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(id => this.verifyAgent(id))
      )
      
      batch.forEach((id, index) => {
        results.set(id, batchResults[index])
      })
    }
    
    return results
  }

  // ===========================================
  // Check if Agent is Currently Banned
  // ===========================================
  async isBanned(agentId: AgentId): Promise<boolean> {
    try {
      const result = await this.client.readContract({
        address: this.registryAddress,
        abi: ERC8004_ABI,
        functionName: 'isBannedByAddress',
        args: [agentId as Address]
      })
      return result as boolean
    } catch {
      // If we can't check, assume worst case
      return true
    }
  }

  // ===========================================
  // Invalidate Cache
  // ===========================================
  invalidateCache(agentId?: AgentId): void {
    if (agentId) {
      this.verificationCache.delete(agentId)
    } else {
      this.verificationCache.clear()
    }
  }

  // ===========================================
  // Helper: Map Status Number to Enum
  // ===========================================
  private mapStatus(status: number): AgentStatus {
    switch (status) {
      case 0: return AgentStatus.ACTIVE
      case 1: return AgentStatus.UPDATED
      case 2: return AgentStatus.BANNED
      default: return AgentStatus.UNREGISTERED
    }
  }

  // ===========================================
  // Helper: Parse Strategy Type
  // ===========================================
  private parseStrategyType(strategy: string): StrategyType {
    const normalized = strategy.toLowerCase()
    switch (normalized) {
      case 'yield': return StrategyType.YIELD
      case 'swap': return StrategyType.SWAP
      case 'bridge': return StrategyType.BRIDGE
      case 'dex_aggregation': return StrategyType.DEX_AGGREGATION
      default: return StrategyType.CUSTOM
    }
  }

  // ===========================================
  // Health Check
  // ===========================================
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getBlockNumber()
      return true
    } catch {
      return false
    }
  }
}

// ===========================================
// Singleton Instance
// ===========================================
let registryInstance: AgentRegistry | null = null

export function initRegistry(config: ManagerConfig): AgentRegistry {
  if (!registryInstance) {
    registryInstance = new AgentRegistry(config)
  }
  return registryInstance
}

export function getRegistry(): AgentRegistry {
  if (!registryInstance) {
    throw new Error('Registry not initialized. Call initRegistry first.')
  }
  return registryInstance
}
