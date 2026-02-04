/**
 * GET /api/v1/monitoring/link-changes
 *
 * 获取换链监控数据
 *
 * 认证：NextAuth Session（管理后台）
 * 权限：USER 和 ADMIN 角色
 * 多租户：自动过滤当前用户数据
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/next-auth'
import { getLinkChangeMonitoring } from '@/lib/monitoring-service'
import type { LinkChangeMonitoringResponse } from '@/types/monitoring'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 1. 验证 Session
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: '未登录或会话已过期',
          },
        },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // 2. 查询监控数据
    const data = await getLinkChangeMonitoring(userId)

    // 3. 返回成功响应
    const response: LinkChangeMonitoringResponse = {
      success: true,
      data,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Monitoring] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: '服务内部错误，请稍后重试',
        },
      },
      { status: 500 }
    )
  }
}
