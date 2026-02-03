/**
 * 健康检查 API
 * 用于 Docker 和 Nginx 健康检查
 */

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * 判断数据库连接是否已配置
 */
function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

export async function GET() {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          database: 'not_configured',
          error: 'DATABASE_URL 未配置',
        },
        { status: 503 }
      )
    }

    // 检查数据库连接
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
    })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    )
  }
}
