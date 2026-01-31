/**
 * 管理端单个联盟链接操作
 *
 * GET    /v1/admin/affiliate-links/[id] - 获取单个联盟链接
 * PUT    /v1/admin/affiliate-links/[id] - 更新联盟链接
 * DELETE /v1/admin/affiliate-links/[id] - 删除联盟链接（软删除）
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponse, parseJsonBody, successResponse } from '@/lib/utils'
import { getSessionUser, getUserIdFilter } from '@/lib/session-auth'

interface UpdateAffiliateLinkRequest {
  url?: string
  enabled?: boolean
  priority?: number
}

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  // 获取当前会话用户
  const authResult = await getSessionUser()
  if (!authResult.success) {
    return errorResponse(authResult.error.code, authResult.error.message, authResult.error.status)
  }

  const userIdFilter = getUserIdFilter(authResult.user)

  try {
    const link = await prisma.affiliateLink.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(userIdFilter && { userId: userIdFilter }),
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

    if (!link) {
      return errorResponse('NOT_FOUND', '联盟链接不存在', 404)
    }

    return successResponse({ link })
  } catch (error) {
    console.error('Admin get affiliate link error:', error)
    return errorResponse('INTERNAL_ERROR', '获取联盟链接失败', 500)
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  // 获取当前会话用户
  const authResult = await getSessionUser()
  if (!authResult.success) {
    return errorResponse(authResult.error.code, authResult.error.message, authResult.error.status)
  }

  const userIdFilter = getUserIdFilter(authResult.user)

  const { data, error: parseError } = await parseJsonBody<UpdateAffiliateLinkRequest>(request)

  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  const { url, enabled, priority } = data || {}

  // 验证 URL 格式（如果提供了 URL）
  if (url !== undefined) {
    try {
      new URL(url)
    } catch {
      return errorResponse('VALIDATION_ERROR', 'url 格式不正确', 422)
    }
  }

  try {
    // 检查联盟链接是否存在（并验证权限）
    const existing = await prisma.affiliateLink.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(userIdFilter && { userId: userIdFilter }),
      },
      select: { id: true },
    })

    if (!existing) {
      return errorResponse('NOT_FOUND', '联盟链接不存在', 404)
    }

    // 构建更新数据
    const updateData: Record<string, unknown> = {}
    if (url !== undefined) {
      updateData.url = url.trim()
    }
    if (enabled !== undefined) {
      updateData.enabled = enabled
    }
    if (priority !== undefined) {
      updateData.priority = priority
    }

    // 更新联盟链接
    const updated = await prisma.affiliateLink.update({
      where: { id },
      data: updateData,
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

    return successResponse({ link: updated })
  } catch (error) {
    console.error('Admin update affiliate link error:', error)
    return errorResponse('INTERNAL_ERROR', '更新联盟链接失败', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  // 获取当前会话用户
  const authResult = await getSessionUser()
  if (!authResult.success) {
    return errorResponse(authResult.error.code, authResult.error.message, authResult.error.status)
  }

  const userIdFilter = getUserIdFilter(authResult.user)

  try {
    // 检查联盟链接是否存在（并验证权限）
    const existing = await prisma.affiliateLink.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(userIdFilter && { userId: userIdFilter }),
      },
      select: { id: true },
    })

    if (!existing) {
      return errorResponse('NOT_FOUND', '联盟链接不存在', 404)
    }

    // 软删除
    await prisma.affiliateLink.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return successResponse({ message: '联盟链接已删除' })
  } catch (error) {
    console.error('Admin delete affiliate link error:', error)
    return errorResponse('INTERNAL_ERROR', '删除联盟链接失败', 500)
  }
}

