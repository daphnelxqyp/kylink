/**
 * Cron 定时任务调度器
 * 
 * 职责：
 * 1. 管理定时任务的注册和执行
 * 2. 支持多种任务类型（补货、回收、清理等）
 * 3. 提供任务执行状态跟踪
 * 
 * 使用方式：
 * - 内部调度：启动时自动运行（开发/单实例部署）
 * - 外部调度：通过 API 端点由外部 Cron 服务触发（生产推荐）
 */

import { replenishAllLowStockWithRetry, type ReplenishFailure } from './stock-producer'
import { checkAndAlert } from './alerting'
import { executeClickTasks } from './click-task-service'
import { prisma } from './prisma'

// 任务执行结果
export interface JobResult {
  jobName: string
  startedAt: Date
  completedAt: Date
  duration: number
  success: boolean
  result?: unknown
  error?: string
}

// 任务历史记录（内存存储，最多保留 100 条）
const jobHistory: JobResult[] = []
const MAX_HISTORY = 100

// 任务定义
interface JobDefinition {
  name: string
  description: string
  intervalMinutes: number
  enabled: boolean
  handler: () => Promise<unknown>
  lastRun?: Date
  nextRun?: Date
}

// 注册的任务
const registeredJobs: Map<string, JobDefinition> = new Map()

// 定时器引用
const jobTimers: Map<string, NodeJS.Timeout> = new Map()

/**
 * 注册任务
 */
export function registerJob(job: JobDefinition): void {
  registeredJobs.set(job.name, job)
  console.log(`[Cron] Registered job: ${job.name} (every ${job.intervalMinutes} min)`)
}

/**
 * 执行单个任务
 */
export async function executeJob(jobName: string): Promise<JobResult> {
  const job = registeredJobs.get(jobName)
  
  if (!job) {
    return {
      jobName,
      startedAt: new Date(),
      completedAt: new Date(),
      duration: 0,
      success: false,
      error: `Job not found: ${jobName}`,
    }
  }

  const startedAt = new Date()
  
  try {
    const result = await job.handler()
    const completedAt = new Date()
    
    const jobResult: JobResult = {
      jobName,
      startedAt,
      completedAt,
      duration: completedAt.getTime() - startedAt.getTime(),
      success: true,
      result,
    }

    // 更新任务状态
    job.lastRun = completedAt
    job.nextRun = new Date(completedAt.getTime() + job.intervalMinutes * 60 * 1000)

    // 记录历史
    addToHistory(jobResult)

    console.log(`[Cron] Job ${jobName} completed in ${jobResult.duration}ms`)
    return jobResult

  } catch (error) {
    const completedAt = new Date()
    
    const jobResult: JobResult = {
      jobName,
      startedAt,
      completedAt,
      duration: completedAt.getTime() - startedAt.getTime(),
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }

    addToHistory(jobResult)
    console.error(`[Cron] Job ${jobName} failed:`, error)
    return jobResult
  }
}

/**
 * 添加到历史记录
 */
function addToHistory(result: JobResult): void {
  jobHistory.unshift(result)
  if (jobHistory.length > MAX_HISTORY) {
    jobHistory.pop()
  }
}

/**
 * 启动内部调度器
 * 
 * 注意：生产环境推荐使用外部 Cron 服务触发 API
 */
export function startInternalScheduler(): void {
  console.log('[Cron] Starting internal scheduler...')

  for (const [name, job] of Array.from(registeredJobs.entries())) {
    if (!job.enabled) {
      console.log(`[Cron] Job ${name} is disabled, skipping`)
      continue
    }

    // 清除已有的定时器
    const existingTimer = jobTimers.get(name)
    if (existingTimer) {
      clearInterval(existingTimer)
    }

    // 设置新的定时器
    const intervalMs = job.intervalMinutes * 60 * 1000
    const timer = setInterval(async () => {
      await executeJob(name)
    }, intervalMs)

    jobTimers.set(name, timer)
    
    // 设置下次运行时间
    job.nextRun = new Date(Date.now() + intervalMs)
    
    console.log(`[Cron] Scheduled job ${name} to run every ${job.intervalMinutes} minutes`)
  }
}

/**
 * 停止内部调度器
 */
export function stopInternalScheduler(): void {
  console.log('[Cron] Stopping internal scheduler...')

  for (const [name, timer] of Array.from(jobTimers.entries())) {
    clearInterval(timer)
    console.log(`[Cron] Stopped job: ${name}`)
  }

  jobTimers.clear()
}

/**
 * 获取任务列表和状态
 */
export function getJobStatus(): {
  jobs: Array<{
    name: string
    description: string
    intervalMinutes: number
    enabled: boolean
    lastRun?: Date
    nextRun?: Date
  }>
  history: JobResult[]
} {
  const jobs = Array.from(registeredJobs.values()).map(job => ({
    name: job.name,
    description: job.description,
    intervalMinutes: job.intervalMinutes,
    enabled: job.enabled,
    lastRun: job.lastRun,
    nextRun: job.nextRun,
  }))

  return {
    jobs,
    history: jobHistory.slice(0, 20), // 返回最近 20 条
  }
}

/**
 * 初始化默认任务
 */
export function initializeDefaultJobs(): void {
  // 从环境变量读取补货间隔，默认 10 分钟
  const replenishInterval = parseInt(
    process.env.REPLENISH_INTERVAL_MINUTES || '10',
    10
  )

  // 1. 库存补货任务 - 可配置间隔
  registerJob({
    name: 'stock_replenish',
    description: '检查并补充低水位库存',
    intervalMinutes: replenishInterval,
    enabled: true,
    handler: async () => {
      const result = await replenishAllLowStockWithRetry()

      // 如果有失败的 campaigns，写入告警
      if (result.failures && result.failures.length > 0) {
        await createReplenishFailureAlert(result.failures)
      }

      return result
    },
  })

  // 2. 监控告警任务 - 保持 10 分钟
  registerJob({
    name: 'monitoring_alert',
    description: '检查系统状态并发送告警',
    intervalMinutes: 10,
    enabled: true,
    handler: checkAndAlert,
  })

  // 3. 刷点击任务执行 - 每 1 分钟
  registerJob({
    name: 'click_task_execute',
    description: '执行到期的刷点击任务',
    intervalMinutes: 1,
    enabled: true,
    handler: executeClickTasks,
  })

  console.log('[Cron] Default jobs initialized')
}

/**
 * 立即执行所有任务（用于测试或手动触发）
 */
export async function executeAllJobs(): Promise<JobResult[]> {
  const results: JobResult[] = []

  for (const [name, job] of Array.from(registeredJobs.entries())) {
    if (job.enabled) {
      const result = await executeJob(name)
      results.push(result)
    }
  }

  return results
}

/**
 * 创建补货失败告警
 */
async function createReplenishFailureAlert(failures: ReplenishFailure[]): Promise<void> {
  try {
    const totalFailed = failures.length
    const level = totalFailed > 10 ? 'critical' : 'warning'

    // 构建告警消息
    const campaignList = failures
      .slice(0, 10)  // 最多显示 10 个
      .map(f => `- ${f.campaignName} (${f.campaignId}): ${f.error}`)
      .join('\n')

    const moreText = totalFailed > 10 ? `\n... 还有 ${totalFailed - 10} 个失败` : ''

    const message = `自动补货任务失败 ${totalFailed} 个 campaigns：\n\n${campaignList}${moreText}`

    // 写入告警表
    await prisma.alert.create({
      data: {
        type: 'STOCK_REPLENISH_FAILED',
        level,
        title: '自动补货失败',
        message,
        metadata: {
          totalFailed,
          failures: failures.map(f => ({
            campaignId: f.campaignId,
            campaignName: f.campaignName,
            userId: f.userId,
            error: f.error,
            retryCount: f.retryCount,
          })),
          timestamp: new Date().toISOString(),
        },
      },
    })

    console.log(`[Cron] Created ${level} alert for ${totalFailed} failed replenishments`)

  } catch (error) {
    console.error('[Cron] Failed to create replenish failure alert:', error)
  }
}

