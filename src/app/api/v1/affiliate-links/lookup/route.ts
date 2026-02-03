/**
 * 联盟链接批量查询 API
 *
 * POST /api/v1/affiliate-links/lookup
 *
 * 功能：根据 campaignId 查询对应的联盟追踪链接
 * 场景：Google Ads 脚本批量获取 Campaign 对应的联盟链接
 *
 * 数据来源：AffiliateLink 表（通过"刷新广告系列"从 Google Sheet 导入）
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/auth'

// ============================================
// 类型定义
// ============================================

interface CampaignLookupItem {
  campaignId: string
  /** 联盟简称（保留兼容，但不再用于查询） */
  networkShortName?: string
  /** 商家 ID（保留兼容，但不再用于查询） */
  mid?: string
  /** 最终到达 URL（保留兼容） */
  finalUrl?: string
}

interface LookupRequest {
  /** 按 campaignId 查询 */
  campaigns?: CampaignLookupItem[]
}

interface TrackingUrlResult {
  trackingUrl: string | null
  campaignId: string | null
  found: boolean
}

interface LookupResponse {
  success: boolean
  /** 按 campaignId 索引的结果 */
  campaignResults: Record<string, TrackingUrlResult>
  stats: {
    total: number
    found: number
    notFound: number
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

  const { campaigns } = body

  // 3. 验证请求参数
  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json(
      { success: false, error: '缺少 campaigns 参数' },
      { status: 400 }
    )
  }

  // 限制单次查询数量
  if (campaigns.length > 500) {
    return NextResponse.json(
      { success: false, error: '单次查询数量不能超过 500 个' },
      { status: 400 }
    )
  }

  // 4. 提取所有 campaignId
  const campaignIds = campaigns.map(c => c.campaignId)

  // 5. 批量查询 AffiliateLink 表（通过 campaignId）
  const affiliateLinks = await prisma.affiliateLink.findMany({
    where: {
      userId,
      campaignId: { in: campaignIds },
      enabled: true,
      deletedAt: null,
    },
    select: {
      campaignId: true,
      url: true,
    },
    orderBy: [
      { priority: 'desc' },
      { updatedAt: 'desc' },
    ],
  })

  // 6. 构建 campaignId -> url 映射（每个 campaignId 只取优先级最高的一条）
  const linkByCampaignId: Record<string, string> = {}
  for (const link of affiliateLinks) {
    if (!linkByCampaignId[link.campaignId]) {
      linkByCampaignId[link.campaignId] = link.url
    }
  }

  // 7. 填充结果
  const campaignResults: Record<string, TrackingUrlResult> = {}
  let foundCount = 0
  let notFoundCount = 0

  for (const campaign of campaigns) {
    const trackingUrl = linkByCampaignId[campaign.campaignId]
    if (trackingUrl) {
      campaignResults[campaign.campaignId] = {
        trackingUrl,
        campaignId: campaign.campaignId,
        found: true,
      }
      foundCount++
    } else {
      campaignResults[campaign.campaignId] = {
        trackingUrl: null,
        campaignId: campaign.campaignId,
        found: false,
      }
      notFoundCount++
    }
  }

  // 8. 返回结果
  const response: LookupResponse = {
    success: true,
    campaignResults,
    stats: {
      total: foundCount + notFoundCount,
      found: foundCount,
      notFound: notFoundCount,
    },
  }

  return NextResponse.json(response)
}
