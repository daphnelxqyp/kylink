/**
 * 刷点击任务服务
 *
 * 职责：
 * 1. 创建点击任务并生成人类作息曲线分布的执行计划
 * 2. 执行单次点击（通过代理访问联盟链接）
 * 3. 批量执行到期的点击任务
 * 4. 管理任务状态（完成、取消、失败）
 *
 * 模拟真人策略：
 * - 时间分布按人类作息曲线（白天密集、凌晨稀疏）
 * - 随机 User-Agent（50+ 真实浏览器指纹）
 * - 随机 Referer（搜索引擎、社交媒体、直接访问）
 * - 每次使用不同代理 IP
 * - 随机延迟模拟阅读行为
 */

import prisma from './prisma'
import {
  getAvailableProxies,
  selectAvailableProxy,
  type ProxySelectionContext,
} from './proxy-selector'
import { trackRedirects } from './redirect/tracker'
import { normalizeCountryCode } from './country-codes'

// ============================================
// 常量配置
// ============================================

/** 每次 Cron 扫描最多执行的点击数 */
const MAX_CLICKS_PER_CRON = 20

/** 点击任务项执行超时（毫秒） */
const CLICK_EXECUTION_TIMEOUT = 120_000

/** 单次点击之间最小间隔（毫秒）—— 防止过快请求 */
const MIN_CLICK_INTERVAL_MS = 3_000

// ============================================
// 人类作息权重（按小时，0-23）
// 模拟真实用户的浏览行为曲线
// ============================================

/**
 * 小时权重表：值越大表示该小时被选中的概率越高
 * 模拟规律：凌晨极低，上午逐渐增加，下午维持高位，晚间达到峰值
 */
const HOUR_WEIGHTS: number[] = [
  0.1, // 00:00
  0.05, // 01:00
  0.02, // 02:00
  0.02, // 03:00
  0.03, // 04:00
  0.05, // 05:00
  0.15, // 06:00
  0.4, // 07:00
  0.8, // 08:00
  1.2, // 09:00
  1.5, // 10:00
  1.6, // 11:00
  1.3, // 12:00（午餐略降）
  1.4, // 13:00
  1.6, // 14:00
  1.7, // 15:00
  1.8, // 16:00
  1.9, // 17:00
  2.0, // 18:00
  2.2, // 19:00（晚间峰值）
  2.0, // 20:00
  1.6, // 21:00
  1.0, // 22:00
  0.5, // 23:00
]

// ============================================
// 真实 User-Agent 库
// ============================================

const USER_AGENTS: string[] = [
  // Chrome Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Chrome Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  // Firefox Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  // Firefox Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
  // Safari Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  // Edge Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
  // Chrome Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  // Mobile Chrome
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  // Mobile Safari
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
]

// ============================================
// 随机 Referer 来源
// ============================================

const REFERERS: string[] = [
  'https://www.google.com/',
  'https://www.google.com/search?q=best+deals',
  'https://www.google.com/search?q=online+shopping',
  'https://www.google.com/search?q=discount+coupon',
  'https://www.bing.com/',
  'https://www.bing.com/search?q=best+deals',
  'https://t.co/',
  'https://t.co/abc123',
  'https://www.facebook.com/',
  'https://www.reddit.com/',
  'https://www.youtube.com/',
  'https://www.instagram.com/',
  'https://www.pinterest.com/',
  '', // 直接访问（无 Referer）
]

// ============================================
// 工具函数
// ============================================

/**
 * 从数组中随机选取一个元素
 */
function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * 生成 min~max 之间的随机整数
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ============================================
// 时间分布算法
// ============================================

/**
 * 生成人类作息曲线分布的点击时间计划
 *
 * 算法：
 * 1. 计算 startTime ~ endOfDay 之间每个整小时的权重
 * 2. 按权重比例分配每个小时应安排的点击数
 * 3. 在每个小时内随机散布点击时间（加随机抖动）
 *
 * @param count 目标点击数
 * @param startTime 开始时间（默认当前时间）
 * @returns 排好序的计划执行时间数组
 */
export function generateClickSchedule(count: number, startTime?: Date): Date[] {
  const now = startTime || new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()

  // 当日结束时间 23:59:59.999
  const endOfDay = new Date(year, month, day, 23, 59, 59, 999)

  // 计算剩余毫秒
  const remainingMs = endOfDay.getTime() - now.getTime()
  if (remainingMs <= 0) {
    // 已过当日，所有点击安排在 1 分钟内随机
    return Array.from({ length: count }, () =>
      new Date(now.getTime() + randomInt(1000, 60000))
    ).sort((a, b) => a.getTime() - b.getTime())
  }

  // 计算当前小时（起始小时）和剩余小时的权重
  const startHour = now.getHours()

  // 构建时间段列表及权重
  interface TimeSlot {
    hour: number
    startMs: number // 相对于 now 的偏移
    endMs: number
    weight: number
  }

  const slots: TimeSlot[] = []

  for (let h = startHour; h <= 23; h++) {
    // 该小时的开始和结束（绝对时间）
    const slotStart = new Date(year, month, day, h, 0, 0, 0)
    const slotEnd = new Date(year, month, day, h, 59, 59, 999)

    // 裁剪为 [now, endOfDay] 范围
    const effectiveStart = Math.max(slotStart.getTime(), now.getTime())
    const effectiveEnd = Math.min(slotEnd.getTime(), endOfDay.getTime())

    if (effectiveEnd <= effectiveStart) continue

    // 计算该小时实际可用比例（首个小时可能不完整）
    const fullHourMs = 60 * 60 * 1000
    const availableRatio = (effectiveEnd - effectiveStart) / fullHourMs

    slots.push({
      hour: h,
      startMs: effectiveStart - now.getTime(),
      endMs: effectiveEnd - now.getTime(),
      weight: HOUR_WEIGHTS[h] * availableRatio,
    })
  }

  if (slots.length === 0) {
    // 极端情况：23:59:59 创建
    return Array.from({ length: count }, () =>
      new Date(now.getTime() + randomInt(100, 500))
    )
  }

  // 按权重分配每个 slot 的点击数
  const totalWeight = slots.reduce((sum, s) => sum + s.weight, 0)
  let remaining = count
  const slotCounts: number[] = slots.map((slot, i) => {
    if (i === slots.length - 1) {
      // 最后一个 slot 分配剩余的
      return remaining
    }
    const allocated = Math.round((slot.weight / totalWeight) * count)
    remaining -= allocated
    return allocated
  })

  // 在每个 slot 内随机生成时间点
  const schedule: Date[] = []

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const clickCount = slotCounts[i]

    for (let j = 0; j < clickCount; j++) {
      // 在 slot 的时间范围内随机
      const offsetMs = slot.startMs + Math.random() * (slot.endMs - slot.startMs)
      schedule.push(new Date(now.getTime() + offsetMs))
    }
  }

  // 排序
  schedule.sort((a, b) => a.getTime() - b.getTime())

  return schedule
}

// ============================================
// 任务创建
// ============================================

/**
 * 创建刷点击任务
 *
 * @param params 任务参数
 * @returns 创建的任务（含子项）
 */
export async function createClickTask(params: {
  userId: string
  campaignId: string
  affiliateLinkId: string
  affiliateUrl: string
  country?: string
  targetClicks: number
}): Promise<{
  task: { id: string; targetClicks: number; status: string }
  itemCount: number
  firstScheduledAt: Date | null
  lastScheduledAt: Date | null
}> {
  const { userId, campaignId, affiliateLinkId, affiliateUrl, country, targetClicks } = params

  // 生成点击时间计划
  const schedule = generateClickSchedule(targetClicks)

  // 创建任务和子项
  const task = await prisma.clickTask.create({
    data: {
      userId,
      campaignId,
      affiliateLinkId,
      affiliateUrl,
      country: country || null,
      targetClicks,
      status: 'running',
      items: {
        create: schedule.map((scheduledAt) => ({
          scheduledAt,
          status: 'pending',
        })),
      },
    },
    select: {
      id: true,
      targetClicks: true,
      status: true,
    },
  })

  return {
    task,
    itemCount: schedule.length,
    firstScheduledAt: schedule.length > 0 ? schedule[0] : null,
    lastScheduledAt: schedule.length > 0 ? schedule[schedule.length - 1] : null,
  }
}

// ============================================
// 点击执行
// ============================================

/**
 * 执行单次点击（通过代理访问联盟链接）
 *
 * 模拟真人行为：
 * - 随机 User-Agent
 * - 随机 Referer
 * - 跟随完整重定向链
 */
async function executeSingleClick(
  affiliateUrl: string,
  proxyContext: ProxySelectionContext,
  targetDomain?: string
): Promise<{
  success: boolean
  exitIp?: string
  error?: string
  duration: number
}> {
  const startTime = Date.now()

  try {
    // 1. 选择可用代理
    const proxySelection = await selectAvailableProxy(proxyContext)

    if (!proxySelection.success || !proxySelection.proxyConfig) {
      return {
        success: false,
        error: '无可用代理: ' + (proxySelection.error || '所有代理不可用'),
        duration: Date.now() - startTime,
      }
    }

    const { proxyConfig, exitIpInfo } = proxySelection

    // 2. 随机选择 User-Agent 和 Referer
    const userAgent = randomPick(USER_AGENTS)
    const referer = randomPick(REFERERS)

    // 3. 通过代理追踪联盟链接重定向
    const trackResult = await trackRedirects({
      url: affiliateUrl,
      proxy: proxyConfig.proxy,
      targetDomain: targetDomain,
      initialReferer: referer || undefined,
      maxRedirects: 15,
      requestTimeout: 25000,
      totalTimeout: CLICK_EXECUTION_TIMEOUT,
      retryCount: 1,
      userAgent,
    })

    const duration = Date.now() - startTime
    const ip = exitIpInfo?.ip || 'unknown'

    if (trackResult.success) {
      console.log(`[click-task] Click success: ${ip}, ${trackResult.redirectCount} redirects, ${duration}ms`)
      return { success: true, exitIp: ip, duration }
    } else {
      console.log(`[click-task] Click failed: ${trackResult.errorMessage}, ${duration}ms`)
      return {
        success: false,
        exitIp: ip,
        error: trackResult.errorMessage || '追踪失败',
        duration,
      }
    }
  } catch (err) {
    const duration = Date.now() - startTime
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[click-task] Click error: ${errorMsg}`)
    return { success: false, error: errorMsg, duration }
  }
}

// ============================================
// 批量执行到期任务（Cron 调用）
// ============================================

/**
 * 执行到期的点击任务项
 *
 * 由 Cron 定时调用（建议每 1-2 分钟）
 * 每次最多执行 MAX_CLICKS_PER_CRON 个点击
 *
 * @returns 执行结果统计
 */
export async function executeClickTasks(): Promise<{
  executed: number
  succeeded: number
  failed: number
  tasksCompleted: number
}> {
  const now = new Date()
  let executed = 0
  let succeeded = 0
  let failed = 0
  let tasksCompleted = 0

  try {
    // 1. 查找所有到期且未执行的点击项
    const pendingItems = await prisma.clickTaskItem.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now },
        task: { status: 'running' },
      },
      include: {
        task: true,
      },
      orderBy: { scheduledAt: 'asc' },
      take: MAX_CLICKS_PER_CRON,
    })

    if (pendingItems.length === 0) {
      return { executed: 0, succeeded: 0, failed: 0, tasksCompleted: 0 }
    }

    console.log(`[click-task] Found ${pendingItems.length} pending click items to execute`)

    // 2. 按任务分组，为每个任务维护代理上下文
    const taskContexts = new Map<string, ProxySelectionContext | null>()
    const taskInfos = new Map<string, {
      userId: string
      affiliateUrl: string
      country: string
      campaignId: string
    }>()

    for (const item of pendingItems) {
      if (!taskContexts.has(item.taskId)) {
        const country = normalizeCountryCode(item.task.country)
        taskInfos.set(item.taskId, {
          userId: item.task.userId,
          affiliateUrl: item.task.affiliateUrl,
          country,
          campaignId: item.task.campaignId,
        })

        // 获取代理上下文
        const ctx = await getAvailableProxies(
          item.task.userId,
          country,
          item.task.campaignId
        )
        taskContexts.set(item.taskId, ctx)
      }
    }

    // 3. 逐个执行（不并发，模拟真人）
    for (const item of pendingItems) {
      const info = taskInfos.get(item.taskId)!
      const proxyContext = taskContexts.get(item.taskId)

      if (!proxyContext) {
        // 无可用代理，标记失败
        await prisma.clickTaskItem.update({
          where: { id: item.id },
          data: {
            status: 'failed',
            error: '无可用代理供应商',
            executedAt: new Date(),
          },
        })
        await prisma.clickTask.update({
          where: { id: item.taskId },
          data: { failedClicks: { increment: 1 } },
        })
        failed++
        executed++
        continue
      }

      // 标记为执行中
      await prisma.clickTaskItem.update({
        where: { id: item.id },
        data: { status: 'executing' },
      })

      // 重置代理上下文索引，每次点击都重新选择
      proxyContext.currentIndex = 0
      proxyContext.triedProxies = []

      // 执行点击
      const result = await executeSingleClick(
        info.affiliateUrl,
        proxyContext
      )

      // 更新点击项结果
      await prisma.clickTaskItem.update({
        where: { id: item.id },
        data: {
          status: result.success ? 'success' : 'failed',
          exitIp: result.exitIp || null,
          error: result.error || null,
          executedAt: new Date(),
          duration: result.duration,
        },
      })

      // 更新任务计数
      if (result.success) {
        await prisma.clickTask.update({
          where: { id: item.taskId },
          data: { completedClicks: { increment: 1 } },
        })
        succeeded++
      } else {
        await prisma.clickTask.update({
          where: { id: item.taskId },
          data: { failedClicks: { increment: 1 } },
        })
        failed++
      }

      executed++

      // 模拟真人间隔
      if (executed < pendingItems.length) {
        const delay = randomInt(MIN_CLICK_INTERVAL_MS, MIN_CLICK_INTERVAL_MS * 3)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    // 4. 检查并更新已完成的任务
    const affectedTaskIds = [...new Set(pendingItems.map((i) => i.taskId))]
    for (const taskId of affectedTaskIds) {
      const task = await prisma.clickTask.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          targetClicks: true,
          completedClicks: true,
          failedClicks: true,
          status: true,
        },
      })

      if (!task || task.status !== 'running') continue

      // 检查是否所有项都已完成
      const pendingCount = await prisma.clickTaskItem.count({
        where: {
          taskId,
          status: { in: ['pending', 'executing'] },
        },
      })

      if (pendingCount === 0) {
        // 所有项都已执行完毕
        const newStatus = task.completedClicks > 0 ? 'completed' : 'failed'
        await prisma.clickTask.update({
          where: { id: taskId },
          data: { status: newStatus },
        })
        tasksCompleted++
        console.log(
          `[click-task] Task ${taskId} ${newStatus}: ${task.completedClicks}/${task.targetClicks} succeeded, ${task.failedClicks} failed`
        )
      }
    }

    console.log(
      `[click-task] Batch complete: ${executed} executed, ${succeeded} succeeded, ${failed} failed, ${tasksCompleted} tasks completed`
    )
  } catch (err) {
    console.error('[click-task] Batch execution error:', err)
  }

  return { executed, succeeded, failed, tasksCompleted }
}

// ============================================
// 任务管理
// ============================================

/**
 * 取消点击任务
 * 将任务状态改为 cancelled，所有 pending 子项也标记为 cancelled
 */
export async function cancelClickTask(taskId: string, userId: string): Promise<boolean> {
  const task = await prisma.clickTask.findFirst({
    where: { id: taskId, userId },
  })

  if (!task) return false
  if (task.status !== 'running') return false

  // 取消所有 pending 子项
  await prisma.clickTaskItem.updateMany({
    where: { taskId, status: 'pending' },
    data: { status: 'cancelled' },
  })

  // 更新任务状态
  await prisma.clickTask.update({
    where: { id: taskId },
    data: { status: 'cancelled' },
  })

  console.log(`[click-task] Task ${taskId} cancelled`)
  return true
}

/**
 * 获取用户的点击任务列表
 */
export async function getClickTasks(userId: string): Promise<{
  tasks: Array<{
    id: string
    campaignId: string
    affiliateUrl: string
    country: string | null
    targetClicks: number
    completedClicks: number
    failedClicks: number
    status: string
    createdAt: Date
    updatedAt: Date
    nextScheduledAt: Date | null
  }>
}> {
  const tasks = await prisma.clickTask.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  // 为每个运行中的任务查找下一个待执行时间
  const result = await Promise.all(
    tasks.map(async (task) => {
      let nextScheduledAt: Date | null = null
      if (task.status === 'running') {
        const nextItem = await prisma.clickTaskItem.findFirst({
          where: { taskId: task.id, status: 'pending' },
          orderBy: { scheduledAt: 'asc' },
          select: { scheduledAt: true },
        })
        nextScheduledAt = nextItem?.scheduledAt || null
      }
      return {
        id: task.id,
        campaignId: task.campaignId,
        affiliateUrl: task.affiliateUrl,
        country: task.country,
        targetClicks: task.targetClicks,
        completedClicks: task.completedClicks,
        failedClicks: task.failedClicks,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        nextScheduledAt,
      }
    })
  )

  return { tasks: result }
}
