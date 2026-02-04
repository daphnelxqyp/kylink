# 自动补货定时任务设计方案

**日期：** 2026-02-04
**状态：** 已批准
**作者：** Claude Code

## 需求概述

在服务器后台添加自动定时任务，每隔 10 分钟自动补货所有低水位的 campaigns，无需手动触发。

## 核心决策

1. **触发方式：** 服务器内置定时器（自动运行）
2. **补货范围：** 一次性补货所有用户的低水位 campaigns
3. **启动控制：** 环境变量控制 + 应用启动时自动启动
4. **间隔配置：** 通过环境变量配置（默认 10 分钟）
5. **错误处理：** 失败重试机制 + 集成现有告警系统
6. **初始化位置：** 使用 Next.js 官方的 `instrumentation.ts`

## 架构设计

### 1. 环境变量配置

新增以下环境变量（`.env` 和 `.env.example`）：

```bash
# 自动定时任务配置
ENABLE_AUTO_CRON=true                    # 是否启用自动定时任务
REPLENISH_INTERVAL_MINUTES=10            # 补货间隔（分钟）
REPLENISH_RETRY_TIMES=3                  # 失败重试次数
REPLENISH_RETRY_DELAY_MS=60000           # 重试间隔（毫秒，默认 1 分钟）
```

**配置说明：**
- `ENABLE_AUTO_CRON`：生产环境设为 `true`，开发环境可设为 `false` 避免干扰
- `REPLENISH_INTERVAL_MINUTES`：根据业务需求调整，建议 5-15 分钟
- `REPLENISH_RETRY_TIMES`：建议 2-3 次，避免过度重试
- `REPLENISH_RETRY_DELAY_MS`：建议 30-60 秒，给代理服务恢复时间

### 2. Instrumentation 初始化

创建 `src/instrumentation.ts`：

```typescript
/**
 * Next.js Instrumentation Hook
 * 在服务启动时初始化定时任务
 */

export async function register() {
  // 只在 Node.js 运行时执行（不在 Edge Runtime）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeDefaultJobs, startInternalScheduler, stopInternalScheduler } =
      await import('./lib/cron-scheduler')

    const enableAutoCron = process.env.ENABLE_AUTO_CRON === 'true'

    if (enableAutoCron) {
      // 初始化并启动定时任务
      initializeDefaultJobs()
      startInternalScheduler()
      console.log('[Instrumentation] Auto cron scheduler started')

      // 优雅关闭处理
      const shutdown = () => {
        console.log('[Instrumentation] Shutting down cron scheduler...')
        stopInternalScheduler()
        process.exit(0)
      }

      process.on('SIGTERM', shutdown)
      process.on('SIGINT', shutdown)
    } else {
      console.log('[Instrumentation] Auto cron disabled (ENABLE_AUTO_CRON=false)')
    }
  }
}
```

修改 `next.config.js`：

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,  // 启用 instrumentation
  },
  // ... 其他配置
}

module.exports = nextConfig
```

### 3. 任务调度器修改

修改 `src/lib/cron-scheduler.ts` 中的 `initializeDefaultJobs()` 函数：

```typescript
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

  // 2. 租约回收任务 - 保持 5 分钟
  registerJob({
    name: 'lease_recovery',
    description: '回收超时未确认的租约',
    intervalMinutes: 5,
    enabled: true,
    handler: recoverExpiredLeases,
  })

  // 3. 监控告警任务 - 保持 10 分钟
  registerJob({
    name: 'monitoring_alert',
    description: '检查系统状态并发送告警',
    intervalMinutes: 10,
    enabled: true,
    handler: checkAndAlert,
  })

  console.log('[Cron] Default jobs initialized')
}
```

### 4. 重试机制实现

在 `src/lib/stock-producer.ts` 中添加重试逻辑：

```typescript
/**
 * 带重试的补货函数
 */
async function replenishWithRetry(
  userId: string,
  campaignId: string,
  force: boolean = false,
  maxRetries: number = 3,
  retryDelay: number = 60000
): Promise<ReplenishResult> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Replenish] Attempt ${attempt}/${maxRetries} for campaign ${campaignId}`)

      const result = await replenishCampaign(userId, campaignId, force)

      if (result.success) {
        if (attempt > 1) {
          console.log(`[Replenish] Success on retry ${attempt} for campaign ${campaignId}`)
        }
        return result
      }

      // 如果返回失败但没有抛出异常，记录错误
      lastError = new Error(result.error || 'Unknown error')

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`[Replenish] Attempt ${attempt} failed for campaign ${campaignId}:`, lastError.message)

      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        console.log(`[Replenish] Waiting ${retryDelay}ms before retry...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
    }
  }

  // 所有重试都失败
  console.error(`[Replenish] All ${maxRetries} attempts failed for campaign ${campaignId}`)
  return {
    success: false,
    error: lastError?.message || 'All retry attempts failed',
    retryCount: maxRetries,
  }
}

/**
 * 带重试的批量补货
 */
export async function replenishAllLowStockWithRetry(
  force: boolean = false,
  progressCallback?: (progress: ReplenishProgress) => void,
  userId?: string
): Promise<ReplenishAllResult> {
  // 从环境变量读取重试配置
  const maxRetries = parseInt(process.env.REPLENISH_RETRY_TIMES || '3', 10)
  const retryDelay = parseInt(process.env.REPLENISH_RETRY_DELAY_MS || '60000', 10)

  // 获取低水位 campaigns
  const campaigns = await getLowStockCampaigns(userId)

  const results: ReplenishResult[] = []
  const failures: ReplenishFailure[] = []

  // 使用现有的并发控制
  const limit = pLimit(parseInt(process.env.CAMPAIGN_CONCURRENCY || '3', 10))

  const tasks = campaigns.map(campaign =>
    limit(async () => {
      const result = await replenishWithRetry(
        campaign.userId,
        campaign.id,
        force,
        maxRetries,
        retryDelay
      )

      results.push(result)

      // 记录失败的 campaign
      if (!result.success) {
        failures.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          userId: campaign.userId,
          error: result.error || 'Unknown error',
          retryCount: maxRetries,
        })
      }

      // 进度回调
      if (progressCallback) {
        progressCallback({
          current: results.length,
          total: campaigns.length,
          campaignId: campaign.id,
          success: result.success,
        })
      }

      return result
    })
  )

  await Promise.all(tasks)

  return {
    total: campaigns.length,
    success: results.filter(r => r.success).length,
    failed: failures.length,
    failures,
    results,
  }
}
```

**类型定义：**

```typescript
interface ReplenishResult {
  success: boolean
  error?: string
  retryCount?: number
  // ... 其他字段
}

interface ReplenishFailure {
  campaignId: string
  campaignName: string
  userId: string
  error: string
  retryCount: number
}

interface ReplenishAllResult {
  total: number
  success: number
  failed: number
  failures: ReplenishFailure[]
  results: ReplenishResult[]
}
```

### 5. 告警集成

在 `src/lib/cron-scheduler.ts` 中添加告警创建函数：

```typescript
import { prisma } from './prisma'

/**
 * 创建补货失败告警
 */
async function createReplenishFailureAlert(failures: ReplenishFailure[]): Promise<void> {
  try {
    const totalFailed = failures.length
    const level = totalFailed > 10 ? 'ERROR' : 'WARNING'

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
```

**Prisma Schema 更新：**

在 `prisma/schema.prisma` 的 `AlertType` 枚举中添加：

```prisma
enum AlertType {
  // ... 现有类型
  STOCK_REPLENISH_FAILED  // 新增
}
```

### 6. 配置文件更新

**`.env.example` 更新：**

```bash
# ... 现有配置

# 自动定时任务配置
ENABLE_AUTO_CRON=true
REPLENISH_INTERVAL_MINUTES=10
REPLENISH_RETRY_TIMES=3
REPLENISH_RETRY_DELAY_MS=60000
```

**`CLAUDE.md` 文档更新：**

在"环境变量"章节添加：

```markdown
ENABLE_AUTO_CRON          # 是否启用自动定时任务（默认 false）
REPLENISH_INTERVAL_MINUTES # 补货间隔分钟数（默认 10）
REPLENISH_RETRY_TIMES     # 补货失败重试次数（默认 3）
REPLENISH_RETRY_DELAY_MS  # 重试间隔毫秒数（默认 60000）
```

在"关键业务规则"章节添加：

```markdown
7. **自动补货机制**：服务启动时自动开始定时补货任务
   - 默认每 10 分钟扫描所有用户的低水位 campaigns
   - 补货失败时自动重试 3 次（间隔 1 分钟）
   - 重试后仍失败则写入告警表，可在管理后台查看
   - 可通过 `ENABLE_AUTO_CRON=false` 关闭自动补货
```

## 测试和验证

### 本地开发测试

1. **启用定时任务**
   ```bash
   # .env.local
   ENABLE_AUTO_CRON=true
   REPLENISH_INTERVAL_MINUTES=1  # 测试用 1 分钟
   ```

2. **启动服务并观察日志**
   ```bash
   npm run dev
   # 应该看到：[Instrumentation] Auto cron scheduler started
   # 应该看到：[Cron] Scheduled job stock_replenish to run every 1 minutes
   ```

3. **等待 1 分钟，检查自动执行**
   ```bash
   # 应该看到：[Cron] Job stock_replenish completed in XXXms
   ```

4. **查看任务状态**
   ```bash
   curl http://localhost:51001/api/v1/jobs
   # 或访问浏览器
   ```

### 重试机制测试

1. **模拟失败场景**
   - 临时关闭代理服务
   - 或设置错误的 `PROXY_API_URL`

2. **观察重试日志**
   ```
   [Replenish] Attempt 1/3 for campaign xxx
   [Replenish] Attempt 1 failed for campaign xxx: ...
   [Replenish] Waiting 60000ms before retry...
   [Replenish] Attempt 2/3 for campaign xxx
   ...
   ```

3. **检查告警**
   - 访问管理后台 `/alerts` 页面
   - 应该看到 `STOCK_REPLENISH_FAILED` 类型的告警
   - 告警内容包含失败的 campaign 列表和错误原因

### 生产环境部署

1. **配置环境变量**
   ```bash
   # /root/kylink/.env
   ENABLE_AUTO_CRON=true
   REPLENISH_INTERVAL_MINUTES=10
   REPLENISH_RETRY_TIMES=3
   REPLENISH_RETRY_DELAY_MS=60000
   ```

2. **重启服务**
   ```bash
   sudo systemctl restart kylink
   ```

3. **检查日志**
   ```bash
   sudo journalctl -u kylink -f
   # 应该看到定时任务启动日志
   ```

4. **监控告警页面**
   - 定期检查 `/alerts` 页面
   - 关注 `STOCK_REPLENISH_FAILED` 告警

### 临时关闭定时任务

如需维护或调试：

1. **修改环境变量**
   ```bash
   ENABLE_AUTO_CRON=false
   ```

2. **重启服务**
   ```bash
   sudo systemctl restart kylink
   ```

3. **手动触发补货**（如需）
   ```bash
   curl -X POST http://localhost:51001/api/v1/jobs/replenish \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"mode": "all"}'
   ```

## 实施步骤

1. **更新 Prisma Schema**
   - 添加 `STOCK_REPLENISH_FAILED` 告警类型
   - 运行 `npm run db:push`

2. **创建 instrumentation.ts**
   - 实现服务启动时的初始化逻辑

3. **修改 next.config.js**
   - 启用 `instrumentationHook`

4. **修改 stock-producer.ts**
   - 添加 `replenishWithRetry` 函数
   - 添加 `replenishAllLowStockWithRetry` 函数
   - 导出新的类型定义

5. **修改 cron-scheduler.ts**
   - 更新 `initializeDefaultJobs` 读取环境变量
   - 添加 `createReplenishFailureAlert` 函数
   - 在 `stock_replenish` 任务中集成告警

6. **更新配置文件**
   - 更新 `.env.example`
   - 更新 `CLAUDE.md`

7. **本地测试**
   - 验证定时任务启动
   - 验证重试机制
   - 验证告警创建

8. **生产部署**
   - 配置环境变量
   - 重启服务
   - 监控运行状态

## 注意事项

1. **多实例部署**
   - 当前设计适用于单实例部署
   - 如需多实例，需要添加分布式锁（Redis）避免重复执行

2. **性能影响**
   - 定时任务在后台执行，不影响 API 响应
   - 并发控制确保不会过载代理服务

3. **告警管理**
   - 定期清理历史告警，避免表过大
   - 可考虑添加告警通知（邮件、Webhook）

4. **监控建议**
   - 监控定时任务执行时长
   - 监控补货成功率
   - 监控告警频率

## 后续优化

1. **分布式锁支持**
   - 使用 Redis 实现分布式锁
   - 支持多实例部署

2. **告警通知**
   - 集成邮件/Webhook 通知
   - 支持告警聚合（避免频繁通知）

3. **任务管理界面**
   - 在管理后台添加定时任务管理页面
   - 支持启动/停止/查看状态

4. **更细粒度的重试策略**
   - 根据错误类型决定是否重试
   - 指数退避重试间隔
