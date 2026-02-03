/**
 * 联盟链接批量查询 API
 *
 * POST /api/v1/affiliate-links/lookup
 *
 * 功能：根据联盟简称 + mid 精确查询对应的联盟追踪链接
 * 场景：Google Ads 脚本批量获取 Campaign 对应的联盟链接
 *
 * 查询优先级：
 * 1. 如果提供了 networkShortName + mid，精确匹配
 * 2. 否则尝试通过 finalUrl 提取域名进行模糊匹配
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/auth'

// ============================================
// 类型定义
// ============================================

interface CampaignLookupItem {
  campaignId: string
  /** 联盟简称（从广告系列名称解析，如 RW, LH, PM） */
  networkShortName?: string
  /** 商家 ID（从广告系列名称解析） */
  mid?: string
  /** 最终到达 URL（备用，用于域名匹配） */
  finalUrl?: string
}

interface LookupRequest {
  /** 按 campaignId + networkShortName + mid 查询（推荐） */
  campaigns?: CampaignLookupItem[]
  /** 或者按域名列表查询（兼容旧版） */
  domains?: string[]
}

interface TrackingUrlResult {
  trackingUrl: string | null
  networkShortName: string | null
  merchantName: string | null
  mid: string | null
  domain: string | null
  found: boolean
}

interface LookupResponse {
  success: boolean
  /** 按 campaignId 索引的结果 */
  campaignResults: Record<string, TrackingUrlResult>
  /** 按域名索引的结果（兼容旧版） */
  results?: Record<string, TrackingUrlResult>
  stats: {
    total: number
    found: number
    notFound: number
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 从 URL 提取域名
 */
function extractDomain(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/i)
    return match ? match[1].toLowerCase() : url.toLowerCase()
  }
}

// ============================================
// API Handler
// ============================================

export async function POST(req: NextRequest) {
  // 1. 鉴权
  const authResult = await authenticateRequest(req)
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { success: false, error: authResult.error?.message || '鉴权失败' },
      { status: authResult.error?.status || 401 }
    )
  }

  const userId = authResult.userId

  // 2. 解析请求
  let body: LookupRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: '无效的请求体' },
      { status: 400 }
    )
  }

  const { campaigns, domains } = body

  // 3. 验证请求参数
  if ((!campaigns || campaigns.length === 0) && (!domains || domains.length === 0)) {
    return NextResponse.json(
      { success: false, error: '缺少 campaigns 或 domains 参数' },
      { status: 400 }
    )
  }

  // 限制单次查询数量
  const totalItems = (campaigns?.length || 0) + (domains?.length || 0)
  if (totalItems > 500) {
    return NextResponse.json(
      { success: false, error: '单次查询数量不能超过 500 个' },
      { status: 400 }
    )
  }

  // 4. 获取用户的所有联盟网络（用于 shortName -> networkId 映射）
  const userNetworks = await prisma.affiliateNetwork.findMany({
    where: {
      userId,
      deletedAt: null,
    },
    select: {
      id: true,
      shortName: true,
    },
  })

  // 构建网络映射（支持前缀匹配，如 "LH" 匹配 "LH1"）
  const networkIdMap: Record<string, string> = {}
  const networkNameMap: Record<string, string> = {} // 记录实际的 shortName
  for (const network of userNetworks) {
    const upperName = network.shortName.toUpperCase()
    networkIdMap[upperName] = network.id
    networkNameMap[upperName] = network.shortName

    // 同时添加去除数字后缀的前缀映射（如 LH1 -> LH 也能匹配）
    const prefix = upperName.replace(/[0-9]+$/, '')
    if (prefix !== upperName && !networkIdMap[prefix]) {
      networkIdMap[prefix] = network.id
      networkNameMap[prefix] = network.shortName
    }
  }

  /**
   * 查找网络 ID（支持前缀匹配）
   */
  function findNetworkId(shortName: string): { networkId: string | null; actualShortName: string | null } {
    const upperName = shortName.toUpperCase()
    // 精确匹配
    if (networkIdMap[upperName]) {
      return { networkId: networkIdMap[upperName], actualShortName: networkNameMap[upperName] }
    }
    // 前缀匹配（如 "LH" 匹配 "LH1"）
    for (const [key, id] of Object.entries(networkIdMap)) {
      if (key.startsWith(upperName) || upperName.startsWith(key.replace(/[0-9]+$/, ''))) {
        return { networkId: id, actualShortName: networkNameMap[key] }
      }
    }
    return { networkId: null, actualShortName: null }
  }

  // 5. 处理 campaigns 查询
  const campaignResults: Record<string, TrackingUrlResult> = {}
  let foundCount = 0
  let notFoundCount = 0

  if (campaigns && campaigns.length > 0) {
    // 分组：有 networkShortName + mid 的走精确查询，其他走域名匹配
    const exactMatchCampaigns: CampaignLookupItem[] = []
    const domainMatchCampaigns: CampaignLookupItem[] = []

    for (const campaign of campaigns) {
      if (campaign.networkShortName && campaign.mid) {
        exactMatchCampaigns.push(campaign)
      } else if (campaign.finalUrl) {
        domainMatchCampaigns.push(campaign)
      } else {
        // 无法查询，标记为未找到
        campaignResults[campaign.campaignId] = {
          trackingUrl: null,
          networkShortName: null,
          merchantName: null,
          mid: null,
          domain: null,
          found: false,
        }
        notFoundCount++
      }
    }

    // 5.1 精确查询：通过 networkShortName + mid
    if (exactMatchCampaigns.length > 0) {
      // 按 networkShortName 分组
      const byNetwork: Record<string, { campaignId: string; mid: string }[]> = {}
      for (const campaign of exactMatchCampaigns) {
        const networkKey = campaign.networkShortName!.toUpperCase()
        if (!byNetwork[networkKey]) {
          byNetwork[networkKey] = []
        }
        byNetwork[networkKey].push({
          campaignId: campaign.campaignId,
          mid: campaign.mid!,
        })
      }

      // 逐个联盟查询
      for (const [networkShortName, items] of Object.entries(byNetwork)) {
        const { networkId, actualShortName } = findNetworkId(networkShortName)
        if (!networkId) {
          // 该联盟不存在，标记所有为未找到
          for (const item of items) {
            campaignResults[item.campaignId] = {
              trackingUrl: null,
              networkShortName,
              merchantName: null,
              mid: item.mid,
              domain: null,
              found: false,
            }
            notFoundCount++
          }
          continue
        }

        // 批量查询该联盟下的 mid
        const mids = items.map((i: { mid: string }) => i.mid)
        const merchants = await prisma.affiliateMerchant.findMany({
          where: {
            userId,
            networkId,
            mid: { in: mids },
            deletedAt: null,
          },
          select: {
            mid: true,
            trackingUrl: true,
            merchantName: true,
            domain: true,
          },
        })

        // 构建 mid -> merchant 映射
        const merchantByMid: Record<string, typeof merchants[0]> = {}
        for (const merchant of merchants) {
          merchantByMid[merchant.mid] = merchant
        }

        // 填充结果
        for (const item of items) {
          const merchant = merchantByMid[item.mid]
          if (merchant) {
            campaignResults[item.campaignId] = {
              trackingUrl: merchant.trackingUrl,
              networkShortName: actualShortName || networkShortName,
              merchantName: merchant.merchantName,
              mid: merchant.mid,
              domain: merchant.domain,
              found: true,
            }
            foundCount++
          } else {
            campaignResults[item.campaignId] = {
              trackingUrl: null,
              networkShortName: actualShortName || networkShortName,
              merchantName: null,
              mid: item.mid,
              domain: null,
              found: false,
            }
            notFoundCount++
          }
        }
      }
    }

    // 5.2 域名匹配查询（备用方案）
    if (domainMatchCampaigns.length > 0) {
      const domainToCampaigns: Record<string, string[]> = {}
      for (const campaign of domainMatchCampaigns) {
        const domain = extractDomain(campaign.finalUrl!)
        if (domain) {
          if (!domainToCampaigns[domain]) {
            domainToCampaigns[domain] = []
          }
          domainToCampaigns[domain].push(campaign.campaignId)
        } else {
          campaignResults[campaign.campaignId] = {
            trackingUrl: null,
            networkShortName: null,
            merchantName: null,
            mid: null,
            domain: null,
            found: false,
          }
          notFoundCount++
        }
      }

      const domainsToQuery = Object.keys(domainToCampaigns)
      if (domainsToQuery.length > 0) {
        const merchants = await prisma.affiliateMerchant.findMany({
          where: {
            userId,
            domain: { in: domainsToQuery },
            deletedAt: null,
          },
          select: {
            domain: true,
            mid: true,
            trackingUrl: true,
            merchantName: true,
            network: {
              select: {
                shortName: true,
              },
            },
          },
          orderBy: [
            { network: { shortName: 'asc' } },
            { updatedAt: 'desc' },
          ],
        })

        // 每个域名只取第一个匹配
        const merchantByDomain: Record<string, typeof merchants[0]> = {}
        for (const merchant of merchants) {
          if (!merchantByDomain[merchant.domain]) {
            merchantByDomain[merchant.domain] = merchant
          }
        }

        // 填充结果
        for (const [domain, campaignIds] of Object.entries(domainToCampaigns)) {
          const merchant = merchantByDomain[domain]
          for (const campaignId of campaignIds) {
            if (merchant) {
              campaignResults[campaignId] = {
                trackingUrl: merchant.trackingUrl,
                networkShortName: merchant.network.shortName,
                merchantName: merchant.merchantName,
                mid: merchant.mid,
                domain: merchant.domain,
                found: true,
              }
              foundCount++
            } else {
              campaignResults[campaignId] = {
                trackingUrl: null,
                networkShortName: null,
                merchantName: null,
                mid: null,
                domain,
                found: false,
              }
              notFoundCount++
            }
          }
        }
      }
    }
  }

  // 6. 处理旧版 domains 查询（兼容）
  let domainResults: Record<string, TrackingUrlResult> | undefined
  if (domains && domains.length > 0) {
    domainResults = {}
    const normalizedDomains = domains.map((d: string) => d.replace(/^www\./, '').toLowerCase())

    const merchants = await prisma.affiliateMerchant.findMany({
      where: {
        userId,
        domain: { in: normalizedDomains },
        deletedAt: null,
      },
      select: {
        domain: true,
        mid: true,
        trackingUrl: true,
        merchantName: true,
        network: {
          select: {
            shortName: true,
          },
        },
      },
      orderBy: [
        { network: { shortName: 'asc' } },
        { updatedAt: 'desc' },
      ],
    })

    const merchantByDomain: Record<string, typeof merchants[0]> = {}
    for (const merchant of merchants) {
      if (!merchantByDomain[merchant.domain]) {
        merchantByDomain[merchant.domain] = merchant
      }
    }

    for (const domain of normalizedDomains) {
      const merchant = merchantByDomain[domain]
      if (merchant) {
        domainResults[domain] = {
          trackingUrl: merchant.trackingUrl,
          networkShortName: merchant.network.shortName,
          merchantName: merchant.merchantName,
          mid: merchant.mid,
          domain: merchant.domain,
          found: true,
        }
        foundCount++
      } else {
        domainResults[domain] = {
          trackingUrl: null,
          networkShortName: null,
          merchantName: null,
          mid: null,
          domain,
          found: false,
        }
        notFoundCount++
      }
    }
  }

  // 7. 返回结果
  const response: LookupResponse = {
    success: true,
    campaignResults,
    stats: {
      total: foundCount + notFoundCount,
      found: foundCount,
      notFound: notFoundCount,
    },
  }

  if (domainResults) {
    response.results = domainResults
  }

  return NextResponse.json(response)
}
