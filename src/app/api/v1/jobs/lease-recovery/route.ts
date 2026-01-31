/**
 * POST /v1/jobs/lease-recovery
 *
 * 租约过期回收定时任务端点
 *
 * 使用场景：
 * 1. Cron Job 定时调用（建议每 5 分钟）
 * 2. 回收超时未 ack 的租约，释放关联库存
 *
 * 安全：需要 CRON_SECRET Bearer Token 认证
 */

import { NextRequest, NextResponse } from 'next/server'
import { recoverExpiredLeases } from '@/lib/lease-recovery'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await recoverExpiredLeases()
    return NextResponse.json({
      success: true,
      recovered: result.recovered,
      message: `Recovered ${result.recovered} expired leases`
    })
  } catch (error) {
    console.error('[LeaseRecovery] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
