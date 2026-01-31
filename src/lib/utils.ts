/**
 * 通用工具函数
 */

/**
 * 计算窗口开始时间（秒级时间戳）
 * 按 cycleMinutes 分桶对齐
 * 
 * @param cycleMinutes 周期分钟数
 * @param timestamp 可选的基准时间戳（毫秒），默认当前时间
 * @returns 对齐后的窗口开始时间（秒级时间戳）
 */
export function calculateWindowStart(cycleMinutes: number, timestamp?: number): number {
  const now = timestamp ?? Date.now()
  const nowSeconds = Math.floor(now / 1000)
  const cycleSeconds = cycleMinutes * 60
  return Math.floor(nowSeconds / cycleSeconds) * cycleSeconds
}

/**
 * 生成幂等键
 * 格式：campaignId:windowStartEpochSeconds
 */
export function generateIdempotencyKey(campaignId: string, windowStartEpochSeconds: number): string {
  return `${campaignId}:${windowStartEpochSeconds}`
}

/**
 * 验证必填字段
 */
/* eslint-disable */
export function validateRequired(
  data: any,
  requiredFields: string[]
): { valid: boolean; missing: string[] } {
  const missing: string[] = []

  for (const field of requiredFields) {
    const value = data?.[field]
    if (value === undefined || value === null || value === '') {
      missing.push(field)
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  }
}
/* eslint-enable */

/**
 * 安全解析 JSON 请求体
 */
export async function parseJsonBody<T>(request: Request): Promise<{ data: T | null; error: string | null }> {
  try {
    const data = await request.json() as T
    return { data, error: null }
  } catch {
    return { data: null, error: '请求体不是有效的 JSON 格式' }
  }
}

/**
 * 构建成功响应
 */
export function successResponse<T>(data: T, status: number = 200): Response {
  return Response.json(
    { success: true, ...data },
    { status }
  )
}

/**
 * 构建错误响应
 */
export function errorResponse(code: string, message: string, status: number = 400): Response {
  return Response.json(
    {
      success: false,
      error: { code, message },
    },
    { status }
  )
}

/**
 * 库存配置常量
 */
export const STOCK_CONFIG = {
  // 单次生产数量
  PRODUCE_BATCH_SIZE: 10,
  // 低水位补货阈值
  LOW_WATERMARK: 3,
  // 租约超时时间（分钟）
  LEASE_TTL_MINUTES: 15,
  // suffix 过期时间（小时）
  SUFFIX_TTL_HOURS: 48,
} as const

/**
 * 动态水位配置常量
 */
export const DYNAMIC_WATERMARK_CONFIG = {
  // 历史统计时间窗口（小时）
  HISTORY_WINDOW_HOURS: 24,
  // 安全系数（倍数）
  SAFETY_FACTOR: 2,
  // 新 campaign 默认水位
  DEFAULT_WATERMARK: 5,
  // 最低水位（兜底）
  MIN_WATERMARK: 3,
  // 最高水位（上限）
  MAX_WATERMARK: 20,
} as const

/**
 * 周期配置
 */
export const CYCLE_CONFIG = {
  // 最小周期（分钟）
  MIN_CYCLE_MINUTES: 10,
  // 最大周期（分钟）
  MAX_CYCLE_MINUTES: 60,
  // 默认周期（分钟）
  DEFAULT_CYCLE_MINUTES: 10,
} as const

/**
 * 验证周期配置
 */
export function validateCycleMinutes(cycleMinutes: number): boolean {
  return cycleMinutes >= CYCLE_CONFIG.MIN_CYCLE_MINUTES &&
         cycleMinutes <= CYCLE_CONFIG.MAX_CYCLE_MINUTES
}

/**
 * 批量接口配置
 */
export const BATCH_CONFIG = {
  // 批量接口最大条数（可通过环境变量配置）
  MAX_BATCH_SIZE: parseInt(process.env.MAX_BATCH_SIZE || '500', 10),
  // 默认批量大小（建议值）
  DEFAULT_BATCH_SIZE: 100,
} as const

