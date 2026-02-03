/**
 * POST /v1/jobs/replenish/stream
 * 
 * 库存补货 SSE 流式接口
 * 
 * 使用场景：
 * 1. 前端实时显示补货进度
 * 2. 提供更好的用户体验
 * 
 * 安全：需要特殊的 CRON_SECRET 或管理员 API Key
 */

import { NextRequest } from 'next/server'
import { 
  replenishAllLowStock, 
  ReplenishProgress,
} from '@/lib/stock-producer'
import { authenticateRequest } from '@/lib/auth'
import { parseJsonBody } from '@/lib/utils'

/**
 * 请求体类型
 */
interface ReplenishStreamRequest {
  force?: boolean  // 是否强制补货（忽略水位检查）
}

/**
 * 格式化 SSE 消息
 */
function formatSSE(data: ReplenishProgress): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: NextRequest) {
  // 1. 检查 CRON_SECRET（优先）或 API Key 鉴权
  const cronSecret = request.headers.get('X-Cron-Secret')
  const expectedSecret = process.env.CRON_SECRET

  let userId: string | null = null

  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    // Cron Job 调用，跳过用户鉴权
    userId = null
  } else {
    // 普通 API 调用，需要鉴权
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return new Response(JSON.stringify({ 
        error: authResult.error?.message || '鉴权失败' 
      }), {
        status: authResult.error?.status || 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    userId = authResult.userId!
  }

  // 2. 解析请求体
  const { data, error: parseError } = await parseJsonBody<ReplenishStreamRequest>(request)
  if (parseError) {
    return new Response(JSON.stringify({ error: parseError }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const force = data?.force ?? false

  console.log(`[replenish-stream] 开始流式补货, userId: ${userId || 'cron'}, force: ${force}`)

  // 3. 创建 SSE 流响应
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 执行补货逻辑，传入进度回调
        await replenishAllLowStock(force, (progress: ReplenishProgress) => {
          const data = formatSSE(progress)
          controller.enqueue(encoder.encode(data))
        }, userId)
      } catch (error) {
        console.error('[replenish-stream] 错误:', error)
        const errorProgress: ReplenishProgress = {
          stage: 'error',
          current: 0,
          total: 0,
          message: error instanceof Error ? error.message : '补货失败',
        }
        controller.enqueue(encoder.encode(formatSSE(errorProgress)))
      } finally {
        console.log('[replenish-stream] 流关闭')
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
    },
  })
}
