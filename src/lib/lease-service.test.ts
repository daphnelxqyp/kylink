/**
 * Lease Service 测试
 *
 * 测试核心业务规则：
 * 1. 换链条件：delta = nowClicks - lastAppliedClicks > 0
 * 2. 幂等性：同一 idempotencyKey 返回同一租约
 * 3. 单租约约束：同一 Campaign 同时仅允许 1 个未 ack 的租约
 * 4. 点击状态单调性：lastAppliedClicks 单调递增
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 必须在导入被测试模块之前导入 Mock
import { prismaMock } from '@/__tests__/mocks/prisma'

import { processSingleLease, processSingleAck } from '@/lib/lease-service'

// Mock stock-producer 模块
vi.mock('@/lib/stock-producer', () => ({
  triggerReplenishAsync: vi.fn(),
}))

describe('Lease Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('processSingleLease - 换链条件', () => {
    const mockRequest = {
      campaignId: 'campaign-123',
      nowClicks: 100,
      observedAt: new Date().toISOString(),
      windowStartEpochSeconds: Math.floor(Date.now() / 1000),
      idempotencyKey: 'key-123',
      meta: {
        campaignName: 'Test Campaign',
        country: 'US',
        finalUrl: 'https://example.com',
        cid: 'cid-123',
        mccId: 'mcc-123',
      },
    }

    it('应该在 delta > 0 时换链（APPLY）', async () => {
      // Mock: 第一次查询 - 检查幂等性（无现有租约）
      prismaMock.suffixLease.findFirst.mockResolvedValueOnce(null)

      // Mock: CampaignMeta 存在
      prismaMock.campaignMeta.findFirst.mockResolvedValue({
        id: 'meta-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        campaignName: 'Test Campaign',
        country: 'US',
        finalUrl: 'https://example.com',
        cid: 'cid-123',
        mccId: 'mcc-123',
        status: 'active',
        lastSyncedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: ClickState 存在，lastAppliedClicks = 50
      prismaMock.campaignClickState.findUnique.mockResolvedValue({
        id: 'state-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        lastAppliedClicks: 50,
        lastObservedClicks: 50,
        lastObservedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 更新 ClickState
      prismaMock.campaignClickState.update.mockResolvedValue({} as any)

      // Mock: 第二次查询 - 检查活跃租约（无活跃租约）
      prismaMock.suffixLease.findFirst.mockResolvedValueOnce(null)

      // Mock: 有可用库存
      prismaMock.suffixStockItem.findFirst.mockResolvedValue({
        id: 'stock-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        finalUrlSuffix: 'gclid=test123',
        status: 'available',
        exitIp: '1.2.3.4',
        sourceAffiliateLinkId: 'link-123',
        leasedAt: null,
        consumedAt: null,
        failedAt: null,
        expiredAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 事务创建租约和更新库存
      prismaMock.$transaction.mockResolvedValue([
        {
          id: 'lease-123',
          userId: 'user-123',
          campaignId: 'campaign-123',
          suffixStockItemId: 'stock-123',
          idempotencyKey: 'key-123',
          nowClicksAtLeaseTime: 100,
          windowStartEpochSeconds: BigInt(mockRequest.windowStartEpochSeconds),
          status: 'leased',
          applied: null,
          leasedAt: new Date(),
          ackedAt: null,
          errorMessage: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {} as any, // 更新库存的结果
      ])

      const result = await processSingleLease('user-123', mockRequest)

      expect(result.action).toBe('APPLY')
      expect(result.leaseId).toBe('lease-123')
      expect(result.finalUrlSuffix).toBe('gclid=test123')
    })

    it('应该在 delta <= 0 时不换链（NOOP）', async () => {
      // Mock: 检查幂等性（无现有租约）
      prismaMock.suffixLease.findFirst.mockResolvedValue(null)

      // Mock: CampaignMeta 存在
      prismaMock.campaignMeta.findFirst.mockResolvedValue({
        id: 'meta-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        campaignName: 'Test Campaign',
        country: 'US',
        finalUrl: 'https://example.com',
        cid: 'cid-123',
        mccId: 'mcc-123',
        status: 'active',
        lastSyncedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: ClickState 存在，lastAppliedClicks = 100（等于 nowClicks）
      prismaMock.campaignClickState.findUnique.mockResolvedValue({
        id: 'state-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        lastAppliedClicks: 100,
        lastObservedClicks: 100,
        lastObservedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 更新 ClickState
      prismaMock.campaignClickState.update.mockResolvedValue({} as any)

      const result = await processSingleLease('user-123', mockRequest)

      expect(result.action).toBe('NOOP')
      expect(result.reason).toContain('delta=0')
    })
  })

  describe('processSingleLease - 幂等性', () => {
    it('应该返回已存在的租约（幂等）', async () => {
      const mockRequest = {
        campaignId: 'campaign-123',
        nowClicks: 100,
        observedAt: new Date().toISOString(),
        windowStartEpochSeconds: Math.floor(Date.now() / 1000),
        idempotencyKey: 'key-123',
      }

      // Mock: 已存在相同 idempotencyKey 的租约
      prismaMock.suffixLease.findFirst.mockResolvedValue({
        id: 'lease-existing',
        userId: 'user-123',
        campaignId: 'campaign-123',
        suffixStockItemId: 'stock-123',
        idempotencyKey: 'key-123',
        nowClicksAtLeaseTime: 100,
        windowStartEpochSeconds: BigInt(mockRequest.windowStartEpochSeconds),
        status: 'leased',
        applied: null,
        leasedAt: new Date(),
        ackedAt: null,
        errorMessage: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        suffixStockItem: {
          id: 'stock-123',
          userId: 'user-123',
          campaignId: 'campaign-123',
          finalUrlSuffix: 'gclid=existing',
          status: 'leased',
          exitIp: '1.2.3.4',
          sourceAffiliateLinkId: 'link-123',
          leasedAt: new Date(),
          consumedAt: null,
          failedAt: null,
          expiredAt: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      } as any)

      const result = await processSingleLease('user-123', mockRequest)

      expect(result.action).toBe('APPLY')
      expect(result.leaseId).toBe('lease-existing')
      expect(result.finalUrlSuffix).toBe('gclid=existing')
      expect(result.reason).toContain('幂等')
    })
  })

  describe('processSingleLease - 边界场景', () => {
    it('应该在 Campaign 未导入时返回 PENDING_IMPORT', async () => {
      const mockRequest = {
        campaignId: 'campaign-new',
        nowClicks: 100,
        observedAt: new Date().toISOString(),
        windowStartEpochSeconds: Math.floor(Date.now() / 1000),
        idempotencyKey: 'key-new',
        // 注意：没有 meta 字段
      }

      // Mock: 无现有租约
      prismaMock.suffixLease.findFirst.mockResolvedValue(null)

      // Mock: CampaignMeta 不存在
      prismaMock.campaignMeta.findFirst.mockResolvedValue(null)

      const result = await processSingleLease('user-123', mockRequest)

      expect(result.code).toBe('PENDING_IMPORT')
      expect(result.message).toContain('未导入')
    })

    it('应该在库存不足时返回 NO_STOCK', async () => {
      const mockRequest = {
        campaignId: 'campaign-123',
        nowClicks: 100,
        observedAt: new Date().toISOString(),
        windowStartEpochSeconds: Math.floor(Date.now() / 1000),
        idempotencyKey: 'key-123',
        meta: {
          campaignName: 'Test Campaign',
          country: 'US',
          finalUrl: 'https://example.com',
          cid: 'cid-123',
          mccId: 'mcc-123',
        },
      }

      // Mock: 无现有租约
      prismaMock.suffixLease.findFirst.mockResolvedValueOnce(null)

      // Mock: CampaignMeta 存在
      prismaMock.campaignMeta.findFirst.mockResolvedValue({
        id: 'meta-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        campaignName: 'Test Campaign',
        country: 'US',
        finalUrl: 'https://example.com',
        cid: 'cid-123',
        mccId: 'mcc-123',
        status: 'active',
        lastSyncedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: ClickState 存在，lastAppliedClicks = 50
      prismaMock.campaignClickState.findUnique.mockResolvedValue({
        id: 'state-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        lastAppliedClicks: 50,
        lastObservedClicks: 50,
        lastObservedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 更新 ClickState
      prismaMock.campaignClickState.update.mockResolvedValue({} as any)

      // Mock: 无活跃租约
      prismaMock.suffixLease.findFirst.mockResolvedValueOnce(null)

      // Mock: 无可用库存
      prismaMock.suffixStockItem.findFirst.mockResolvedValue(null)

      const result = await processSingleLease('user-123', mockRequest)

      expect(result.code).toBe('NO_STOCK')
      expect(result.message).toContain('库存不足')
    })

    it('应该返回已存在的活跃租约', async () => {
      const mockRequest = {
        campaignId: 'campaign-123',
        nowClicks: 100,
        observedAt: new Date().toISOString(),
        windowStartEpochSeconds: Math.floor(Date.now() / 1000),
        idempotencyKey: 'key-new',
        meta: {
          campaignName: 'Test Campaign',
          country: 'US',
          finalUrl: 'https://example.com',
          cid: 'cid-123',
          mccId: 'mcc-123',
        },
      }

      // Mock: 无现有租约（幂等性检查）
      prismaMock.suffixLease.findFirst.mockResolvedValueOnce(null)

      // Mock: CampaignMeta 存在
      prismaMock.campaignMeta.findFirst.mockResolvedValue({
        id: 'meta-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        campaignName: 'Test Campaign',
        country: 'US',
        finalUrl: 'https://example.com',
        cid: 'cid-123',
        mccId: 'mcc-123',
        status: 'active',
        lastSyncedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: ClickState 存在，lastAppliedClicks = 50
      prismaMock.campaignClickState.findUnique.mockResolvedValue({
        id: 'state-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        lastAppliedClicks: 50,
        lastObservedClicks: 50,
        lastObservedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 更新 ClickState
      prismaMock.campaignClickState.update.mockResolvedValue({} as any)

      // Mock: 有活跃租约
      prismaMock.suffixLease.findFirst.mockResolvedValueOnce({
        id: 'lease-active',
        userId: 'user-123',
        campaignId: 'campaign-123',
        suffixStockItemId: 'stock-123',
        idempotencyKey: 'key-old',
        nowClicksAtLeaseTime: 80,
        windowStartEpochSeconds: BigInt(Math.floor(Date.now() / 1000) - 300),
        status: 'leased',
        applied: null,
        leasedAt: new Date(),
        ackedAt: null,
        errorMessage: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        suffixStockItem: {
          id: 'stock-123',
          userId: 'user-123',
          campaignId: 'campaign-123',
          finalUrlSuffix: 'gclid=active123',
          status: 'leased',
          exitIp: '1.2.3.4',
          sourceAffiliateLinkId: 'link-123',
          leasedAt: new Date(),
          consumedAt: null,
          failedAt: null,
          expiredAt: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      } as any)

      const result = await processSingleLease('user-123', mockRequest)

      expect(result.action).toBe('APPLY')
      expect(result.leaseId).toBe('lease-active')
      expect(result.finalUrlSuffix).toBe('gclid=active123')
      expect(result.reason).toContain('已存在的活跃租约')
    })

    it('应该在 Campaign 不存在时惰性创建', async () => {
      const mockRequest = {
        campaignId: 'campaign-new',
        nowClicks: 100,
        observedAt: new Date().toISOString(),
        windowStartEpochSeconds: Math.floor(Date.now() / 1000),
        idempotencyKey: 'key-new',
        meta: {
          campaignName: 'New Campaign',
          country: 'US',
          finalUrl: 'https://example.com',
          cid: 'cid-new',
          mccId: 'mcc-new',
        },
      }

      // Mock: 无现有租约
      prismaMock.suffixLease.findFirst.mockResolvedValueOnce(null)

      // Mock: CampaignMeta 不存在
      prismaMock.campaignMeta.findFirst.mockResolvedValue(null)

      // Mock: 创建 CampaignMeta
      prismaMock.campaignMeta.create.mockResolvedValue({
        id: 'meta-new',
        userId: 'user-123',
        campaignId: 'campaign-new',
        campaignName: 'New Campaign',
        country: 'US',
        finalUrl: 'https://example.com',
        cid: 'cid-new',
        mccId: 'mcc-new',
        status: 'active',
        lastSyncedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: ClickState 不存在，需要创建
      prismaMock.campaignClickState.findUnique.mockResolvedValue(null)

      // Mock: 创建 ClickState
      prismaMock.campaignClickState.create.mockResolvedValue({
        id: 'state-new',
        userId: 'user-123',
        campaignId: 'campaign-new',
        lastAppliedClicks: 0,
        lastObservedClicks: 100,
        lastObservedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 无活跃租约
      prismaMock.suffixLease.findFirst.mockResolvedValueOnce(null)

      // Mock: 有可用库存
      prismaMock.suffixStockItem.findFirst.mockResolvedValue({
        id: 'stock-new',
        userId: 'user-123',
        campaignId: 'campaign-new',
        finalUrlSuffix: 'gclid=new123',
        status: 'available',
        exitIp: '1.2.3.4',
        sourceAffiliateLinkId: 'link-123',
        leasedAt: null,
        consumedAt: null,
        failedAt: null,
        expiredAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 事务创建租约和更新库存
      prismaMock.$transaction.mockResolvedValue([
        {
          id: 'lease-new',
          userId: 'user-123',
          campaignId: 'campaign-new',
          suffixStockItemId: 'stock-new',
          idempotencyKey: 'key-new',
          nowClicksAtLeaseTime: 100,
          windowStartEpochSeconds: BigInt(mockRequest.windowStartEpochSeconds),
          status: 'leased',
          applied: null,
          leasedAt: new Date(),
          ackedAt: null,
          errorMessage: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {} as any,
      ])

      const result = await processSingleLease('user-123', mockRequest)

      expect(result.action).toBe('APPLY')
      expect(result.leaseId).toBe('lease-new')
      expect(result.finalUrlSuffix).toBe('gclid=new123')
      expect(prismaMock.campaignMeta.create).toHaveBeenCalled()
      expect(prismaMock.campaignClickState.create).toHaveBeenCalled()
    })
  })

  describe('processSingleAck', () => {
    it('应该成功确认租约', async () => {
      const mockAck = {
        leaseId: 'lease-123',
        campaignId: 'campaign-123',
        applied: true,
        appliedAt: new Date().toISOString(),
      }

      // Mock: 租约存在
      prismaMock.suffixLease.findFirst.mockResolvedValue({
        id: 'lease-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        suffixStockItemId: 'stock-123',
        idempotencyKey: 'key-123',
        nowClicksAtLeaseTime: 100,
        windowStartEpochSeconds: BigInt(Math.floor(Date.now() / 1000)),
        status: 'leased',
        applied: null,
        leasedAt: new Date(),
        ackedAt: null,
        errorMessage: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 事务更新租约、库存和点击状态
      prismaMock.$transaction.mockResolvedValue([
        {} as any, // 更新租约
        {} as any, // 更新库存
        1, // executeRaw 返回影响的行数
      ])

      const result = await processSingleAck('user-123', mockAck)

      expect(result.ok).toBe(true)
      expect(result.leaseId).toBe('lease-123')
    })

    it('应该拒绝不存在的租约', async () => {
      const mockAck = {
        leaseId: 'lease-nonexistent',
        campaignId: 'campaign-123',
        applied: true,
        appliedAt: new Date().toISOString(),
      }

      // Mock: 租约不存在
      prismaMock.suffixLease.findFirst.mockResolvedValue(null)

      const result = await processSingleAck('user-123', mockAck)

      expect(result.ok).toBe(false)
      expect(result.message).toContain('租约不存在')
    })

    it('应该拒绝已确认的租约（幂等）', async () => {
      const mockAck = {
        leaseId: 'lease-123',
        campaignId: 'campaign-123',
        applied: true,
        appliedAt: new Date().toISOString(),
      }

      // Mock: 租约已确认
      prismaMock.suffixLease.findFirst.mockResolvedValue({
        id: 'lease-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        suffixStockItemId: 'stock-123',
        idempotencyKey: 'key-123',
        nowClicksAtLeaseTime: 100,
        windowStartEpochSeconds: BigInt(Math.floor(Date.now() / 1000)),
        status: 'consumed',
        applied: true,
        leasedAt: new Date(),
        ackedAt: new Date(),
        errorMessage: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await processSingleAck('user-123', mockAck)

      expect(result.ok).toBe(true)
      expect(result.message).toContain('幂等')
      expect(result.previousStatus).toBe('consumed')
    })

    it('应该处理 Ack 失败场景（applied: false）', async () => {
      const mockAck = {
        leaseId: 'lease-123',
        campaignId: 'campaign-123',
        applied: false,
        appliedAt: new Date().toISOString(),
        errorMessage: '写入失败：权限不足',
      }

      // Mock: 租约存在
      prismaMock.suffixLease.findFirst.mockResolvedValue({
        id: 'lease-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        suffixStockItemId: 'stock-123',
        idempotencyKey: 'key-123',
        nowClicksAtLeaseTime: 100,
        windowStartEpochSeconds: BigInt(Math.floor(Date.now() / 1000)),
        status: 'leased',
        applied: null,
        leasedAt: new Date(),
        ackedAt: null,
        errorMessage: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 事务更新租约和库存（失败场景会释放库存回可用池）
      prismaMock.$transaction.mockResolvedValue([
        {} as any, // 更新租约为 failed
        {} as any, // 更新库存为 available
      ])

      const result = await processSingleAck('user-123', mockAck)

      expect(result.ok).toBe(true)
      expect(result.leaseId).toBe('lease-123')
    })
  })
})
