/**
 * 管理端联盟链接管理
 *
 * GET  /v1/admin/affiliate-links          - 获取联盟链接列表
 * POST /v1/admin/affiliate-links          - 创建联盟链接
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponse, parseJsonBody, successResponse, validateRequired } from '@/lib/utils'
import { getSessionUser, getUserIdFilter } from '@/lib/session-auth'

interface CreateAffiliateLinkRequest {
  userId: string
  campaignId: string
  url: string
  enabled?: boolean
  priority?: number
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
    const campaignId = searchParams.get('campaignId') || ''
    const userId = searchParams.get('userId') || ''

    // 构建查询条件
    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(userIdFilter && { userId: userIdFilter }),
    }

    if (campaignId) {
      where.campaignId = campaignId
    }

    // 只有管理员可以按 userId 过滤其他用户的数据
    if (userId && !userIdFilter) {
      where.userId = userId
    }

    // 查询联盟链接列表
    const links = await prisma.affiliateLink.findMany({
      where,
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
        createdAt: true,
        updatedAt: true,
      },
    })

    return successResponse({ links, total: links.length })
  } catch (error) {
    console.error('Admin affiliate links list error:', error)
    return errorResponse('INTERNAL_ERROR', '获取联盟链接列表失败', 500)
  }
}

export async function POST(request: NextRequest) {
  // 获取当前会话用户
  const authResult = await getSessionUser()
  if (!authResult.success) {
    return errorResponse(authResult.error.code, authResult.error.message, authResult.error.status)
  }

  const { data, error: parseError } = await parseJsonBody<CreateAffiliateLinkRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  const { valid, missing } = validateRequired(data || {}, ['userId', 'campaignId', 'url'])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  let { userId, campaignId, url, enabled = true, priority = 0 } = data!

  // 非管理员只能为自己创建链接
  if (authResult.user.role !== 'ADMIN') {
    userId = authResult.user.id
  }

  // 验证 URL 格式
  try {
    new URL(url)
  } catch {
    return errorResponse('VALIDATION_ERROR', 'url 格式不正确', 422)
  }

  try {
    // 检查广告系列是否存在
    const campaign = await prisma.campaignMeta.findFirst({
      where: {
        userId,
        campaignId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (!campaign) {
      return errorResponse('NOT_FOUND', '指定的广告系列不存在', 404)
    }

    // 创建联盟链接
    const created = await prisma.affiliateLink.create({
      data: {
        userId,
        campaignId,
        url: url.trim(),
        enabled,
        priority,
      },
      select: {
        id: true,
        userId: true,
        campaignId: true,
        url: true,
        enabled: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return successResponse({ link: created }, 201)
  } catch (error) {
    console.error('Admin create affiliate link error:', error)
    return errorResponse('INTERNAL_ERROR', '创建联盟链接失败', 500)
  }
}

