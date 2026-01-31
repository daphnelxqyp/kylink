/**
 * GET/POST /v1/jobs
 * 
 * 定时任务管理端点
 * 
 * 功能：
 * - GET: 获取任务列表和执行状态
 * - POST: 执行指定任务或所有任务
 * 
 * 安全：
 * - 支持 CRON_SECRET 头（定时任务调用）
 * - 支持 API Key 鉴权（手动调用）
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { 
  initializeDefaultJobs,
  executeJob,
  executeAllJobs,
  getJobStatus,
} from '@/lib/cron-scheduler'
import { 
  parseJsonBody, 
  successResponse, 
  errorResponse,
} from '@/lib/utils'

// 确保默认任务已初始化
let initialized = false
function ensureInitialized() {
  if (!initialized) {
    initializeDefaultJobs()
    initialized = true
  }
}

// 请求体类型
interface JobExecuteRequest {
  jobName?: string  // 可选，不提供则执行所有
  immediate?: boolean  // 是否立即执行（绕过时间检查）
}

/**
 * 验证 Cron Secret 或 API Key
 */
async function authenticate(request: NextRequest): Promise<{
  success: boolean
  error?: { code: string; message: string; status: number }
}> {
  // 检查 CRON_SECRET（优先）
  const cronSecret = request.headers.get('X-Cron-Secret')
  const expectedSecret = process.env.CRON_SECRET

  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    return { success: true }
  }

  // 检查 API Key
  const authResult = await authenticateRequest(request)
  if (!authResult.success) {
    return {
      success: false,
      error: authResult.error,
    }
  }

  return { success: true }
}

/**
 * GET /v1/jobs - 获取任务状态
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.success) {
    return errorResponse(auth.error!.code, auth.error!.message, auth.error!.status)
  }

  ensureInitialized()

  try {
    const status = getJobStatus()
    return successResponse(status)
  } catch (error) {
    console.error('Get job status error:', error)
    return errorResponse('INTERNAL_ERROR', '获取任务状态失败', 500)
  }
}

/**
 * POST /v1/jobs - 执行任务
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.success) {
    return errorResponse(auth.error!.code, auth.error!.message, auth.error!.status)
  }

  ensureInitialized()

  // 解析请求体
  const { data, error: parseError } = await parseJsonBody<JobExecuteRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }
  const jobName = data?.jobName

  try {
    if (jobName) {
      // 执行指定任务
      const result = await executeJob(jobName)
      return successResponse({
        mode: 'single',
        jobName,
        immediate: Boolean(data?.immediate),
        result,
      })
    } else {
      // 执行所有任务
      const results = await executeAllJobs()
      return successResponse({
        mode: 'all',
        immediate: Boolean(data?.immediate),
        results,
        summary: {
          total: results.length,
          success: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        },
      })
    }
  } catch (error) {
    console.error('Execute job error:', error)
    return errorResponse('INTERNAL_ERROR', '执行任务失败', 500)
  }
}

