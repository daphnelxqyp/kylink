/**
 * GET/POST /v1/admin/click-tasks
 *
 * 刷点击任务管理端点
 *
 * 功能：
 * - GET: 获取当前用户的点击任务列表
 * - POST: 创建新的刷点击任务
 *
 * 安全：会话认证（NextAuth）
 */

import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session-auth'
import { createClickTask, getClickTasks } from '@/lib/click-task-service'
import {
  parseJsonBody,
  successResponse,
  errorResponse,
} from '@/lib/utils'
import prisma from '@/lib/prisma'

/** 创建任务请求体 */
interface CreateClickTaskRequest {
  campaignId: string
  affiliateLinkId: string
  targetClicks: number
}

/**
 * GET /v1/admin/click-tasks - 获取点击任务列表
 */
export async function GET() {
  const authResult = await getSessionUser()
  if (!authResult.success) {
    return errorResponse(
      authResult.error.code,
      authResult.error.message,
      authResult.error.status
    )
  }

  try {
    const result = await getClickTasks(authResult.user.id)
    return successResponse(result)
  } catch (error) {
    console.error('[click-tasks] GET error:', error)
    return errorResponse('INTERNAL_ERROR', '获取点击任务列表失败', 500)
  }
}

/**
 * POST /v1/admin/click-tasks - 创建刷点击任务
 */
export async function POST(request: NextRequest) {
  const authResult = await getSessionUser()
  if (!authResult.success) {
    return errorResponse(
      authResult.error.code,
      authResult.error.message,
      authResult.error.status
    )
  }

  const { data, error: parseError } = await parseJsonBody<CreateClickTaskRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '无效的请求体', 422)
  }

  const { campaignId, affiliateLinkId, targetClicks } = data

  // 参数校验
  if (!campaignId || !affiliateLinkId) {
    return errorResponse('VALIDATION_ERROR', '缺少 campaignId 或 affiliateLinkId', 422)
  }
  if (!targetClicks || targetClicks < 1 || targetClicks > 1000) {
    return errorResponse('VALIDATION_ERROR', '点击数量必须在 1-1000 之间', 422)
  }

  try {
    // 校验联盟链接存在且属于当前用户
    const affiliateLink = await prisma.affiliateLink.findFirst({
      where: {
        id: affiliateLinkId,
        userId: authResult.user.id,
        campaignId,
        deletedAt: null,
      },
    })

    if (!affiliateLink) {
      return errorResponse('NOT_FOUND', '未找到联盟链接', 404)
    }

    if (!affiliateLink.enabled) {
      return errorResponse('VALIDATION_ERROR', '联盟链接已禁用', 422)
    }

    // 获取 campaign 国家
    const campaign = await prisma.campaignMeta.findFirst({
      where: {
        userId: authResult.user.id,
        campaignId,
        deletedAt: null,
      },
      select: { country: true },
    })

    // 检查是否有运行中的任务（同一链接）
    const runningTask = await prisma.clickTask.findFirst({
      where: {
        userId: authResult.user.id,
        campaignId,
        affiliateLinkId,
        status: 'running',
      },
    })

    if (runningTask) {
      return errorResponse(
        'CONFLICT',
        '该联盟链接已有运行中的刷点击任务，请先取消或等待完成',
        409
      )
    }

    // 创建任务
    const result = await createClickTask({
      userId: authResult.user.id,
      campaignId,
      affiliateLinkId,
      affiliateUrl: affiliateLink.url,
      country: campaign?.country || undefined,
      targetClicks,
    })

    return successResponse({
      ...result,
      message: `已创建 ${targetClicks} 次点击任务，将在今天 23:59 前完成`,
    })
  } catch (error) {
    console.error('[click-tasks] POST error:', error)
    return errorResponse('INTERNAL_ERROR', '创建点击任务失败', 500)
  }
}
