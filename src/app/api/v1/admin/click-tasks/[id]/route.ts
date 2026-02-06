/**
 * POST /v1/admin/click-tasks/:id/cancel
 * DELETE /v1/admin/click-tasks/:id
 *
 * 取消/删除刷点击任务
 *
 * 安全：会话认证（NextAuth）
 */

import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session-auth'
import { cancelClickTask } from '@/lib/click-task-service'
import { successResponse, errorResponse } from '@/lib/utils'

/**
 * DELETE /v1/admin/click-tasks/:id - 取消点击任务
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await getSessionUser()
  if (!authResult.success) {
    return errorResponse(
      authResult.error.code,
      authResult.error.message,
      authResult.error.status
    )
  }

  const taskId = params.id
  if (!taskId) {
    return errorResponse('VALIDATION_ERROR', '缺少任务 ID', 422)
  }

  try {
    const cancelled = await cancelClickTask(taskId, authResult.user.id)

    if (!cancelled) {
      return errorResponse('NOT_FOUND', '任务不存在或无法取消（可能已完成）', 404)
    }

    return successResponse({ message: '任务已取消' })
  } catch (error) {
    console.error('[click-tasks] DELETE error:', error)
    return errorResponse('INTERNAL_ERROR', '取消任务失败', 500)
  }
}
