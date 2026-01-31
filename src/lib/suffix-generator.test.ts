/**
 * Suffix Generator 测试
 *
 * 测试 Suffix 生成逻辑，包括：
 * - 代理选择
 * - 降级逻辑
 * - URL 追踪
 * - Suffix 构建
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 必须在导入被测试模块之前导入 Mock
import { prismaMock } from '@/__tests__/mocks/prisma'

import { generateSuffix, isProxyServiceAvailable } from '@/lib/suffix-generator'

// Mock proxy-selector 模块
vi.mock('@/lib/proxy-selector', () => ({
  getAvailableProxies: vi.fn(),
  selectAvailableProxy: vi.fn(),
  recordProxyUsage: vi.fn(),
}))

// Mock redirect tracker 模块
vi.mock('@/lib/redirect/tracker', () => ({
  trackRedirects: vi.fn(),
  extractDomain: vi.fn((url: string) => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }),
}))

import * as proxySelector from '@/lib/proxy-selector'
import * as redirectTracker from '@/lib/redirect/tracker'

describe('Suffix Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isProxyServiceAvailable', () => {
    it('应该检查用户是否有可用代理', async () => {
      prismaMock.proxyProvider.count.mockResolvedValue(1)

      const result = await isProxyServiceAvailable('user-123')

      expect(result).toBe(true)
      expect(prismaMock.proxyProvider.count).toHaveBeenCalledWith({
        where: {
          enabled: true,
          deletedAt: null,
          assignedUsers: {
            some: {
              userId: 'user-123',
            },
          },
        },
      })
    })

    it('应该在无代理时返回 false', async () => {
      prismaMock.proxyProvider.count.mockResolvedValue(0)

      const result = await isProxyServiceAvailable('user-123')

      expect(result).toBe(false)
    })

    it('应该在无 userId 时检查全局代理', async () => {
      prismaMock.proxyProvider.count.mockResolvedValue(1)

      const result = await isProxyServiceAvailable()

      expect(result).toBe(true)
      expect(prismaMock.proxyProvider.count).toHaveBeenCalledWith({
        where: {
          enabled: true,
          deletedAt: null,
        },
      })
    })
  })

  describe('generateSuffix', () => {
    const mockRequest = {
      userId: 'user-123',
      campaignId: 'campaign-456',
      affiliateLinkId: 'link-789',
      affiliateUrl: 'https://affiliate.com/link',
      country: 'US',
    }

    it('应该在无代理且 ALLOW_MOCK_SUFFIX=false 时返回错误', async () => {
      // 保存原始环境变量
      const originalEnv = process.env.ALLOW_MOCK_SUFFIX

      // 设置环境变量为 false
      process.env.ALLOW_MOCK_SUFFIX = 'false'

      // 需要重新导入模块以应用新的环境变量
      // 由于 Vitest 的模块缓存，我们需要使用 vi.resetModules()
      vi.resetModules()

      // 重新导入模块
      const { generateSuffix: generateSuffixReloaded } = await import('@/lib/suffix-generator')
      const { getAvailableProxies } = await import('@/lib/proxy-selector')

      vi.mocked(getAvailableProxies).mockResolvedValue(null)

      const result = await generateSuffixReloaded(mockRequest)

      expect(result.success).toBe(false)
      expect(result.error).toContain('NO_PROXY_AVAILABLE')

      // 恢复环境变量
      process.env.ALLOW_MOCK_SUFFIX = originalEnv
    })

    it('应该在无代理且 ALLOW_MOCK_SUFFIX=true 时返回模拟数据', async () => {
      process.env.ALLOW_MOCK_SUFFIX = 'true'

      vi.mocked(proxySelector.getAvailableProxies).mockResolvedValue(null)

      const result = await generateSuffix(mockRequest)

      expect(result.success).toBe(true)
      expect(result.finalUrlSuffix).toContain('gclid=mock_')
      expect(result.error).toContain('MOCK_MODE')
    })

    it('应该成功生成 suffix（有代理）', async () => {
      const mockProxyContext = {
        userId: 'user-123',
        campaignId: 'campaign-456',
        country: 'US',
        providers: [
          {
            id: 'provider-1',
            name: 'Test Provider',
            priority: 1,
            enabled: true,
            proxyType: 'socks5' as const,
            proxyHost: 'proxy.test.com',
            proxyPort: 1080,
            proxyUsername: 'user',
            proxyPassword: 'pass',
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        currentIndex: 0,
      }

      const mockProxySelection = {
        success: true,
        proxyConfig: {
          provider: mockProxyContext.providers[0],
          proxy: {
            type: 'socks5' as const,
            host: 'proxy.test.com',
            port: 1080,
            username: 'user',
            password: 'pass',
          },
        },
        exitIpInfo: {
          ip: '1.2.3.4',
          country: 'US',
        },
        triedProxies: [],
      }

      const mockTrackResult = {
        success: true,
        finalUrl: 'https://target.com/page?gclid=abc123&utm_source=google',
        redirectCount: 3,
        redirectChain: [],
      }

      vi.mocked(proxySelector.getAvailableProxies).mockResolvedValue(mockProxyContext)
      vi.mocked(proxySelector.selectAvailableProxy).mockResolvedValue(mockProxySelection)
      vi.mocked(redirectTracker.trackRedirects).mockResolvedValue(mockTrackResult)
      vi.mocked(proxySelector.recordProxyUsage).mockResolvedValue()

      const result = await generateSuffix(mockRequest)

      expect(result.success).toBe(true)
      expect(result.finalUrlSuffix).toBe('gclid=abc123&utm_source=google')
      expect(result.exitIp).toBe('1.2.3.4')
      expect(result.trackedUrl).toBe(mockTrackResult.finalUrl)
      expect(result.redirectCount).toBe(3)
    })

    it('应该在追踪失败时尝试下一个代理', async () => {
      const mockProxyContext = {
        userId: 'user-123',
        campaignId: 'campaign-456',
        country: 'US',
        providers: [
          {
            id: 'provider-1',
            name: 'Provider 1',
            priority: 1,
            enabled: true,
            proxyType: 'socks5' as const,
            proxyHost: 'proxy1.test.com',
            proxyPort: 1080,
            proxyUsername: 'user',
            proxyPassword: 'pass',
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'provider-2',
            name: 'Provider 2',
            priority: 2,
            enabled: true,
            proxyType: 'socks5' as const,
            proxyHost: 'proxy2.test.com',
            proxyPort: 1080,
            proxyUsername: 'user',
            proxyPassword: 'pass',
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        currentIndex: 0,
      }

      // 第一次选择代理成功，但追踪失败
      const mockProxySelection1 = {
        success: true,
        proxyConfig: {
          provider: mockProxyContext.providers[0],
          proxy: {
            type: 'socks5' as const,
            host: 'proxy1.test.com',
            port: 1080,
            username: 'user',
            password: 'pass',
          },
        },
        exitIpInfo: {
          ip: '1.2.3.4',
          country: 'US',
        },
        triedProxies: [],
      }

      // 第二次选择代理成功，追踪也成功
      const mockProxySelection2 = {
        success: true,
        proxyConfig: {
          provider: mockProxyContext.providers[1],
          proxy: {
            type: 'socks5' as const,
            host: 'proxy2.test.com',
            port: 1080,
            username: 'user',
            password: 'pass',
          },
        },
        exitIpInfo: {
          ip: '5.6.7.8',
          country: 'US',
        },
        triedProxies: [],
      }

      const mockTrackResultFail = {
        success: false,
        errorMessage: 'Connection timeout',
        finalUrl: '',
        redirectCount: 0,
        redirectChain: [],
      }

      const mockTrackResultSuccess = {
        success: true,
        finalUrl: 'https://target.com/page?gclid=xyz789',
        redirectCount: 2,
        redirectChain: [],
      }

      vi.mocked(proxySelector.getAvailableProxies).mockResolvedValue(mockProxyContext)
      vi.mocked(proxySelector.selectAvailableProxy)
        .mockResolvedValueOnce(mockProxySelection1)
        .mockResolvedValueOnce(mockProxySelection2)
      vi.mocked(redirectTracker.trackRedirects)
        .mockResolvedValueOnce(mockTrackResultFail)
        .mockResolvedValueOnce(mockTrackResultSuccess)
      vi.mocked(proxySelector.recordProxyUsage).mockResolvedValue()

      const result = await generateSuffix(mockRequest)

      expect(result.success).toBe(true)
      expect(result.finalUrlSuffix).toBe('gclid=xyz789')
      expect(result.exitIp).toBe('5.6.7.8')
      expect(proxySelector.selectAvailableProxy).toHaveBeenCalledTimes(2)
    })

    it('应该拒绝无效的 URL', async () => {
      const invalidRequest = {
        ...mockRequest,
        affiliateUrl: 'not-a-valid-url',
      }

      const result = await generateSuffix(invalidRequest)

      expect(result.success).toBe(false)
      expect(result.error).toContain('INVALID_URL')
    })
  })

  describe('generateSuffixBatch', () => {
    it('应该批量生成 suffix', async () => {
      const { generateSuffixBatch } = await import('@/lib/suffix-generator')

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
      })

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
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mock: generateSuffix 成功
      const mockProxyContext = {
        userId: 'user-123',
        campaignId: 'campaign-123',
        country: 'US',
        providers: [
          {
            id: 'provider-1',
            name: 'Test Provider',
            priority: 1,
            enabled: true,
            proxyType: 'socks5' as const,
            proxyHost: 'proxy.test.com',
            proxyPort: 1080,
            proxyUsername: 'user',
            proxyPassword: 'pass',
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        currentIndex: 0,
      }

      const mockProxySelection = {
        success: true,
        proxyConfig: {
          provider: mockProxyContext.providers[0],
          proxy: {
            type: 'socks5' as const,
            host: 'proxy.test.com',
            port: 1080,
            username: 'user',
            password: 'pass',
          },
        },
        exitIpInfo: {
          ip: '1.2.3.4',
          country: 'US',
        },
        triedProxies: [],
      }

      const mockTrackResult = {
        success: true,
        finalUrl: 'https://target.com/page?gclid=batch123&utm_source=google',
        redirectCount: 3,
        redirectChain: [],
      }

      vi.mocked(proxySelector.getAvailableProxies).mockResolvedValue(mockProxyContext)
      vi.mocked(proxySelector.selectAvailableProxy).mockResolvedValue(mockProxySelection)
      vi.mocked(redirectTracker.trackRedirects).mockResolvedValue(mockTrackResult)
      vi.mocked(proxySelector.recordProxyUsage).mockResolvedValue()

      const result = await generateSuffixBatch('user-123', 'campaign-123', 3)

      expect(result.generated).toBe(3)
      expect(result.failed).toBe(0)
      expect(result.results).toHaveLength(3)
      expect(result.results[0].success).toBe(true)
      expect(result.results[0].finalUrlSuffix).toContain('gclid=batch123')
    })

    it('应该在无联盟链接时返回错误', async () => {
      const { generateSuffixBatch } = await import('@/lib/suffix-generator')

      // Mock: 联盟链接不存在
      prismaMock.affiliateLink.findFirst.mockResolvedValue(null)

      const result = await generateSuffixBatch('user-123', 'campaign-123', 3)

      expect(result.generated).toBe(0)
      expect(result.failed).toBe(3)
      expect(result.results[0].success).toBe(false)
      expect(result.results[0].error).toContain('NO_AFFILIATE_LINK')
    })
  })
})
