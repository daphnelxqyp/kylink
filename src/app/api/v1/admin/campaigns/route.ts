/**
 * 管理端广告系列列表
 *
 * GET /v1/admin/campaigns - 获取广告系列列表（含联盟链接详情）
 * PATCH /v1/admin/campaigns - 更新广告系列信息（如国家代码）
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponse, successResponse, parseJsonBody } from '@/lib/utils'
import { getSessionUser, getUserIdFilter } from '@/lib/session-auth'

export const dynamic = 'force-dynamic'

/**
 * PATCH 请求体类型
 */
interface UpdateCampaignRequest {
  campaignId: string
  country?: string
}

export async function GET(request: NextRequest) {
  try {
    // 获取当前会话用户
    const authResult = await getSessionUser()
    if (!authResult.success) {
      return errorResponse(authResult.error.code, authResult.error.message, authResult.error.status)
    }

    const userIdFilter = getUserIdFilter(authResult.user)

    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''

    // 构建查询条件
    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(userIdFilter && { userId: userIdFilter }),
    }

    // 搜索条件：支持 campaignId, campaignName, cid 模糊搜索
    if (search) {
      where.OR = [
        { campaignId: { contains: search } },
        { campaignName: { contains: search } },
        { cid: { contains: search } },
      ]
    }

    // 状态过滤
    if (status && (status === 'active' || status === 'inactive')) {
      where.status = status
    }

    // 查询广告系列列表
    const campaigns = await prisma.campaignMeta.findMany({
      where,
      orderBy: [
        { campaignName: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        userId: true,
        campaignId: true,
        campaignName: true,
        country: true,
        finalUrl: true,
        cid: true,
        mccId: true,
        status: true,
        lastSyncedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // 获取每个广告系列的联盟链接
    const campaignIds = campaigns.map((c: { campaignId: string }) => c.campaignId)
    const userIds = campaigns.map((c: { userId: string }) => c.userId)

    // 获取所有关联的联盟链接
    const affiliateLinks = await prisma.affiliateLink.findMany({
      where: {
        campaignId: { in: campaignIds },
        userId: { in: userIds },
        deletedAt: null,
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        userId: true,
        campaignId: true,
        url: true,
        enabled: true,
        priority: true,
      },
    })

    // 构建联盟链接映射（每个 campaign 取优先级最高的一个）
    const linkMap = new Map<string, typeof affiliateLinks[0]>()
    for (const link of affiliateLinks) {
      const key = `${link.userId}:${link.campaignId}`
      if (!linkMap.has(key)) {
        linkMap.set(key, link)
      }
    }

    // 联盟链接统计
    const affiliateLinkCounts = await prisma.affiliateLink.groupBy({
      by: ['campaignId', 'userId'],
      where: {
        campaignId: { in: campaignIds },
        userId: { in: userIds },
        deletedAt: null,
      },
      _count: { id: true },
    })

    // 库存统计
    const stockCounts = await prisma.suffixStockItem.groupBy({
      by: ['campaignId', 'userId'],
      where: {
        campaignId: { in: campaignIds },
        userId: { in: userIds },
        deletedAt: null,
        status: 'available',
      },
      _count: { id: true },
    })

    // 构建查找映射
    const linkCountMap = new Map<string, number>()
    for (const item of affiliateLinkCounts) {
      linkCountMap.set(`${item.userId}:${item.campaignId}`, item._count.id)
    }

    const stockCountMap = new Map<string, number>()
    for (const item of stockCounts) {
      stockCountMap.set(`${item.userId}:${item.campaignId}`, item._count.id)
    }

    // 组装结果
    type CampaignItem = typeof campaigns[number]
    const result = campaigns.map((campaign: CampaignItem) => {
      const key = `${campaign.userId}:${campaign.campaignId}`
      const affiliateLink = linkMap.get(key)
      return {
        ...campaign,
        affiliateLinkCount: linkCountMap.get(key) || 0,
        stockCount: stockCountMap.get(key) || 0,
        // 联盟链接详情
        affiliateLinkId: affiliateLink?.id || null,
        affiliateLinkUrl: affiliateLink?.url || null,
        affiliateLinkEnabled: affiliateLink?.enabled ?? null,
      }
    })

    return successResponse({ campaigns: result, total: result.length })
  } catch (error) {
    console.error('Admin campaigns list error:', error)
    return errorResponse('INTERNAL_ERROR', '获取广告系列列表失败', 500)
  }
}

/**
 * PATCH /v1/admin/campaigns
 * 
 * 更新广告系列信息（如国家代码）
 */
export async function PATCH(request: NextRequest) {
  try {
    // 获取当前会话用户
    const authResult = await getSessionUser()
    if (!authResult.success) {
      return errorResponse(authResult.error.code, authResult.error.message, authResult.error.status)
    }

    const userIdFilter = getUserIdFilter(authResult.user)

    // 解析请求体
    const { data, error: parseError } = await parseJsonBody<UpdateCampaignRequest>(request)
    if (parseError || !data) {
      return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
    }

    const { campaignId, country } = data

    if (!campaignId) {
      return errorResponse('VALIDATION_ERROR', 'campaignId 为必填项', 422)
    }

    // 查找广告系列
    const campaign = await prisma.campaignMeta.findFirst({
      where: {
        campaignId,
        deletedAt: null,
        ...(userIdFilter && { userId: userIdFilter }),
      },
    })

    if (!campaign) {
      return errorResponse('NOT_FOUND', '广告系列不存在', 404)
    }

    // 构建更新数据
    const updateData: { country?: string | null } = {}
    
    // 更新国家代码（允许清空）
    if (country !== undefined) {
      // 验证国家代码格式（2-3 位大写字母，或空字符串）
      const trimmedCountry = country.trim().toUpperCase()
      if (trimmedCountry && !/^[A-Z]{2,3}$/.test(trimmedCountry)) {
        return errorResponse('VALIDATION_ERROR', '国家代码格式无效，应为 2-3 位大写字母（如 US、GB）', 422)
      }
      updateData.country = trimmedCountry || null
    }

    // 如果没有要更新的字段
    if (Object.keys(updateData).length === 0) {
      return errorResponse('VALIDATION_ERROR', '没有要更新的字段', 422)
    }

    // 执行更新
    const updated = await prisma.campaignMeta.update({
      where: { id: campaign.id },
      data: updateData,
      select: {
        id: true,
        campaignId: true,
        campaignName: true,
        country: true,
      },
    })

    return successResponse({ campaign: updated })
  } catch (error) {
    console.error('Update campaign error:', error)
    return errorResponse('INTERNAL_ERROR', '更新广告系列失败', 500)
  }
}

