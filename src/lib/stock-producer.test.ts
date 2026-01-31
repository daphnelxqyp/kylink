/**
 * Stock Producer 测试
 *
 * 测试库存补货逻辑：
 * 1. 动态水位计算
 * 2. 库存检查
 * 3. 补货逻辑
 * 4. 并发控制
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 必须在导入被测试模块之前导入 Mock
import { prismaMock } from '@/__tests__/mocks/prisma'

import { replenishCampaign, checkStockLevel } from '@/lib/stock-producer'

// Mock suffix-generator 模块
vi.mock('@/lib/suffix-generator', () => ({
  generateSuffix: vi.fn(),
  isProxyServiceAvailable: vi.fn(),
}))

import * as suffixGenerator from '@/lib/suffix-generator'

describe('Stock Producer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkStockLevel', () => {
    it('应该检查库存水位并判断是否需要补货', async () => {
      // Mock: 当前库存 2 条
      prismaMock.suffixStockItem.count.mockResolvedValue(2)

      // Mock: 过去 24 小时消费记录（用于计算动态水位）
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(2) // 当前库存
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(10) // 过去 24 小时消费数

      const result = await checkStockLevel('user-123', 'campaign-123')

      expect(result.availableCount).toBe(2)
      expect(result.needsReplenish).toBe(true)
      expect(result.deficit).toBeGreaterThan(0)
    })

    it('应该在库存充足时返回不需要补货', async () => {
      // Mock: 当前库存 15 条
      prismaMock.suffixStockItem.count.mockResolvedValue(15)

      // Mock: 过去 24 小时消费记录
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(15) // 当前库存
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(5) // 过去 24 小时消费数

      const result = await checkStockLevel('user-123', 'campaign-123')

      expect(result.availableCount).toBe(15)
      expect(result.needsReplenish).toBe(false)
      expect(result.deficit).toBe(0)
    })
  })

  describe('replenishCampaign', () => {
    it('应该在库存充足时跳过补货', async () => {
      // Mock: 当前库存 15 条
      prismaMock.suffixStockItem.count.mockResolvedValue(15)

      // Mock: 过去 24 小时消费记录
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(15) // 当前库存
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(5) // 过去 24 小时消费数

      const result = await replenishCampaign('user-123', 'campaign-123', false)

      expect(result.status).toBe('skipped')
      expect(result.producedCount).toBe(0)
      expect(result.message).toContain('库存充足')
    })

    it('应该在库存不足时补货', async () => {
      // Mock: 当前库存 2 条
      prismaMock.suffixStockItem.count.mockResolvedValue(2)

      // Mock: 过去 24 小时消费记录
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(2) // 当前库存
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(10) // 过去 24 小时消费数

      // Mock: 联盟链接存在
      prismaMock.affiliateLink.findFirst.mockResolvedValue({
        id: 'link-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        url: 'https://affiliate.com/link',
        priority: 1,
        enabled: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)

      // Mock: Campaign 存在
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
        lastImportedAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 有可用代理
      vi.mocked(suffixGenerator.isProxyServiceAvailable).mockResolvedValue(true)

      // Mock: generateSuffix 成功
      vi.mocked(suffixGenerator.generateSuffix).mockResolvedValue({
        success: true,
        finalUrlSuffix: 'gclid=test123',
        exitIp: '1.2.3.4',
        trackedUrl: 'https://target.com/page?gclid=test123',
        redirectCount: 3,
      })

      // Mock: 批量创建库存
      prismaMock.suffixStockItem.createMany.mockResolvedValue({ count: 8 })

      // Mock: 创建审计日志
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await replenishCampaign('user-123', 'campaign-123', false)

      expect(result.status).toBe('success')
      expect(result.producedCount).toBe(8)
      expect(result.message).toContain('成功补货')
    })

    it('应该在无联盟链接时使用模拟数据', async () => {
      // Mock: 当前库存 2 条
      prismaMock.suffixStockItem.count.mockResolvedValue(2)

      // Mock: 过去 24 小时消费记录
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(2) // 当前库存
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(10) // 过去 24 小时消费数

      // Mock: 联盟链接不存在
      prismaMock.affiliateLink.findFirst.mockResolvedValue(null)

      // Mock: Campaign 存在
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
        lastImportedAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 无可用代理
      vi.mocked(suffixGenerator.isProxyServiceAvailable).mockResolvedValue(false)

      // Mock: 批量创建库存（使用模拟数据）
      prismaMock.suffixStockItem.createMany.mockResolvedValue({ count: 8 })

      // Mock: 创建审计日志
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await replenishCampaign('user-123', 'campaign-123', false)

      expect(result.status).toBe('success')
      expect(result.producedCount).toBe(8)
    })

    it('应该在强制补货时忽略库存水位', async () => {
      // Mock: 当前库存 15 条（充足）
      prismaMock.suffixStockItem.count.mockResolvedValue(15)

      // Mock: 过去 24 小时消费记录
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(15) // 当前库存
      prismaMock.suffixStockItem.count.mockResolvedValueOnce(5) // 过去 24 小时消费数

      // Mock: 联盟链接存在
      prismaMock.affiliateLink.findFirst.mockResolvedValue({
        id: 'link-123',
        userId: 'user-123',
        campaignId: 'campaign-123',
        url: 'https://affiliate.com/link',
        priority: 1,
        enabled: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)

      // Mock: Campaign 存在
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
        lastImportedAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: 有可用代理
      vi.mocked(suffixGenerator.isProxyServiceAvailable).mockResolvedValue(true)

      // Mock: generateSuffix 成功
      vi.mocked(suffixGenerator.generateSuffix).mockResolvedValue({
        success: true,
        finalUrlSuffix: 'gclid=force123',
        exitIp: '1.2.3.4',
        trackedUrl: 'https://target.com/page?gclid=force123',
        redirectCount: 3,
      })

      // Mock: 批量创建库存
      prismaMock.suffixStockItem.createMany.mockResolvedValue({ count: 10 })

      // Mock: 创建审计日志
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await replenishCampaign('user-123', 'campaign-123', true)

      expect(result.status).toBe('success')
      expect(result.producedCount).toBe(10)
      expect(result.message).toContain('成功补货')
    })
  })
})
