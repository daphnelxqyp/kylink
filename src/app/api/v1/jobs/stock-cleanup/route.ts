/**
 * POST /v1/jobs/stock-cleanup
 *
 * 库存过期清理定时任务端点
 *
 * 使用场景：
 * 1. Cron Job 定时调用（建议每小时）
 * 2. 清理超过 48 小时的过期 available 状态库存
 *
 * 安全：需要 CRON_SECRET Bearer Token 认证
 */

import { NextRequest, NextResponse } from 'next/server'
import { cleanupExpiredStock } from '@/lib/lease-recovery'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await cleanupExpiredStock()
    return NextResponse.json({
      success: true,
      cleaned: result.cleaned,
      message: `Cleaned ${result.cleaned} expired stock items`
    })
  } catch (error) {
    console.error('[StockCleanup] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
