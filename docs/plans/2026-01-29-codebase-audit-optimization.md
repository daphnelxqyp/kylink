# KyAds SuffixPool 代码审计优化计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复代码审计中发现的关键问题，提升系统稳定性、性能和代码质量

**Architecture:** 按优先级分阶段修复：先修复关键逻辑错误，再优化性能，最后改进代码质量

**Tech Stack:** Next.js 14, Prisma, MySQL, TypeScript

---

## 阶段一：关键逻辑修复（Critical）

### Task 1: 修复失败租约库存未回收问题

**问题:** `ack/route.ts` 中失败的租约不会立即回收库存，但 `lease-service.ts` 会。行为不一致。

**Files:**
- Modify: `src/app/api/v1/suffix/ack/route.ts:116-130`

**Step 1: 阅读当前实现**

查看 `src/app/api/v1/suffix/ack/route.ts` 第 116-130 行的失败处理逻辑。

**Step 2: 添加库存回收逻辑**

在失败分支中添加库存回收：

```typescript
} else {
  // 写入失败：更新租约状态为 failed
  await prisma.suffixLease.update({
    where: { id: leaseId },
    data: {
      status: 'failed',
      applied: false,
      ackedAt: new Date(appliedAt),
      errorMessage: errorMessage || '写入失败（未提供详细原因）',
    },
  })

  // 立即回收库存（与 lease-service.ts 行为一致）
  if (lease.stockItemId) {
    await prisma.suffixStockItem.update({
      where: { id: lease.stockItemId },
      data: { status: 'available', leasedAt: null },
    })
    console.log(`[Ack] Stock ${lease.stockItemId} recovered from failed lease ${leaseId}`)
  }
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功，无类型错误

**Step 4: Commit**

```bash
git add src/app/api/v1/suffix/ack/route.ts
git commit -m "fix: recover stock immediately on failed lease ack"
```

---

### Task 2: 修复批量 Ack 的库存回收问题

**问题:** 批量 ack 同样存在失败租约不回收库存的问题

**Files:**
- Modify: `src/app/api/v1/suffix/ack/batch/route.ts:115-130`

**Step 1: 阅读当前实现**

查看 `src/app/api/v1/suffix/ack/batch/route.ts` 的失败处理逻辑。

**Step 2: 添加库存回收逻辑**

在批量处理的失败分支中添加库存回收（与 Task 1 相同逻辑）。

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/app/api/v1/suffix/ack/batch/route.ts
git commit -m "fix: recover stock immediately on failed batch lease ack"
```

---

### Task 3: 添加租约过期回收定时任务

**问题:** `lease-recovery.ts` 中的 `recoverExpiredLeases()` 从未被调用

**Files:**
- Modify: `src/lib/cron-scheduler.ts` (如存在)
- Create: `src/app/api/v1/jobs/lease-recovery/route.ts` (如不存在)

**Step 1: 检查现有定时任务配置**

查看 `src/lib/cron-scheduler.ts` 和 `src/app/api/v1/jobs/` 目录结构。

**Step 2: 创建或修改租约回收任务路由**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { recoverExpiredLeases } from '@/lib/lease-recovery'

export async function POST(request: NextRequest) {
  // 验证 CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await recoverExpiredLeases()
    return NextResponse.json({
      success: true,
      recovered: result.recoveredCount,
      message: `Recovered ${result.recoveredCount} expired leases`
    })
  } catch (error) {
    console.error('[LeaseRecovery] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/app/api/v1/jobs/
git commit -m "feat: add lease recovery cron job endpoint"
```

---

### Task 4: 添加库存清理定时任务

**问题:** `cleanupExpiredStock()` 从未被调用

**Files:**
- Create: `src/app/api/v1/jobs/stock-cleanup/route.ts`

**Step 1: 创建库存清理任务路由**

```typescript
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
      cleaned: result.cleanedCount,
      message: `Cleaned ${result.cleanedCount} expired stock items`
    })
  } catch (error) {
    console.error('[StockCleanup] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

**Step 2: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add src/app/api/v1/jobs/stock-cleanup/route.ts
git commit -m "feat: add stock cleanup cron job endpoint"
```

---

## 阶段二：性能优化（High Priority）

### Task 5: 添加数据库索引

**问题:** 缺少关键查询的索引，影响性能

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: 阅读当前 schema**

查看 `prisma/schema.prisma` 中现有的索引定义。

**Step 2: 添加缺失的索引**

在相关模型中添加索引：

```prisma
model SuffixLease {
  // ... existing fields ...

  @@index([userId, status, leasedAt])  // 用于租约回收查询
  @@index([campaignId, status])         // 用于检查活跃租约
}

model SuffixStockItem {
  // ... existing fields ...

  @@index([userId, campaignId, status, createdAt])  // 用于库存清理
  @@index([status, createdAt])                       // 用于过期库存查询
}

model CampaignClickState {
  // ... existing fields ...

  @@index([userId, campaignId])  // 用于点击状态查询
}
```

**Step 3: 生成迁移**

Run: `npm run db:push` (或 `npx prisma db push`)
Expected: Schema 更新成功

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "perf: add database indexes for common queries"
```

---

### Task 6: 优化代理 IP 检测（并行化）

**问题:** 代理 IP 检测串行执行，最坏情况 32 秒

**Files:**
- Modify: `src/lib/proxy-selector.ts:196-235`

**Step 1: 阅读当前实现**

查看 `proxy-selector.ts` 中的 IP 检测逻辑。

**Step 2: 改为并行检测**

```typescript
async function checkProxyExitIp(proxyUrl: string): Promise<string | null> {
  const fullProxyUrl = proxyUrl.startsWith('socks5://') ? proxyUrl : `socks5://${proxyUrl}`

  // 并行尝试所有 IP 检测服务，取第一个成功的
  const checkPromises = IP_CHECK_SERVICES.map(async (service) => {
    try {
      const agent = new SocksProxyAgent(fullProxyUrl, { timeout: 5000 })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(service.url, {
        agent: agent as unknown as import('http').Agent,
        signal: controller.signal as unknown as AbortSignal,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })

      clearTimeout(timeout)

      if (!response.ok) return null

      const data = await response.text()
      const ip = service.parser(data)
      return ip || null
    } catch {
      return null
    }
  })

  // 使用 Promise.any 获取第一个成功结果
  try {
    return await Promise.any(checkPromises)
  } catch {
    return null
  }
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/lib/proxy-selector.ts
git commit -m "perf: parallelize proxy IP detection for faster suffix generation"
```

---

### Task 7: 优化 Campaign 资格查询（合并为单次查询）

**问题:** `getEligibleCampaigns()` 执行两次查询，可合并

**Files:**
- Modify: `src/lib/stock-producer.ts:341-405`

**Step 1: 阅读当前实现**

查看 `getEligibleCampaigns()` 函数。

**Step 2: 使用 Prisma 关联查询优化**

```typescript
export async function getEligibleCampaigns(): Promise<Array<{
  userId: string
  campaignId: string
  campaignName: string | null
  country: string | null
  hasAffiliateLink: boolean
}>> {
  // 使用单次查询，通过关联过滤
  const campaigns = await prisma.campaignMeta.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      country: { not: null },
      // 通过关联过滤：必须有启用的联盟链接
      affiliateLinks: {
        some: {
          enabled: true,
          deletedAt: null,
          url: { not: '' },
        },
      },
    },
    select: {
      userId: true,
      campaignId: true,
      campaignName: true,
      country: true,
    },
    distinct: ['userId', 'campaignId'],
  })

  return campaigns.map(c => ({
    ...c,
    hasAffiliateLink: true,
  }))
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/lib/stock-producer.ts
git commit -m "perf: optimize getEligibleCampaigns to single query"
```

---

## 阶段三：代码质量改进（Medium Priority）

### Task 8: 统一 Lease 处理逻辑（消除重复）

**问题:** Lease 处理逻辑在 3 个地方重复

**Files:**
- Modify: `src/app/api/v1/suffix/lease/route.ts`
- Reference: `src/lib/lease-service.ts`

**Step 1: 阅读 lease-service.ts 的 requestLease 函数**

确认 `lease-service.ts` 中的 `requestLease()` 函数功能完整。

**Step 2: 重构 route.ts 使用 lease-service**

```typescript
import { requestLease } from '@/lib/lease-service'

export async function POST(request: NextRequest) {
  try {
    const user = await validateApiKey(request)
    if (!user) {
      return errorResponse('UNAUTHORIZED', '无效的 API Key', 401)
    }

    const body = await request.json()
    const validation = leaseRequestSchema.safeParse(body)
    if (!validation.success) {
      return errorResponse('VALIDATION_ERROR', validation.error.message, 422)
    }

    const result = await requestLease(user.id, validation.data)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('[Lease] Error:', error)
    return errorResponse('INTERNAL_ERROR', '服务内部错误', 500)
  }
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/app/api/v1/suffix/lease/route.ts
git commit -m "refactor: use lease-service in lease route handler"
```

---

### Task 9: 统一 Ack 处理逻辑（消除重复）

**问题:** Ack 处理逻辑在 3 个地方重复

**Files:**
- Modify: `src/app/api/v1/suffix/ack/route.ts`
- Reference: `src/lib/lease-service.ts`

**Step 1: 确认 lease-service.ts 的 ackLease 函数**

确认 `lease-service.ts` 中的 `ackLease()` 函数功能完整且包含库存回收。

**Step 2: 重构 route.ts 使用 lease-service**

```typescript
import { ackLease } from '@/lib/lease-service'

export async function POST(request: NextRequest) {
  try {
    const user = await validateApiKey(request)
    if (!user) {
      return errorResponse('UNAUTHORIZED', '无效的 API Key', 401)
    }

    const body = await request.json()
    const validation = ackRequestSchema.safeParse(body)
    if (!validation.success) {
      return errorResponse('VALIDATION_ERROR', validation.error.message, 422)
    }

    const result = await ackLease(user.id, validation.data)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('[Ack] Error:', error)
    return errorResponse('INTERNAL_ERROR', '服务内部错误', 500)
  }
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/app/api/v1/suffix/ack/route.ts
git commit -m "refactor: use lease-service in ack route handler"
```

---

### Task 10: 修复 getStockStats 使用动态水位

**问题:** `getStockStats` 使用固定水位判断 `needsReplenish`，与动态水位逻辑不一致

**Files:**
- Modify: `src/lib/stock-producer.ts:635-716`

**Step 1: 阅读当前实现**

查看 `getStockStats()` 函数和 `calculateDynamicWatermark()` 函数。

**Step 2: 修改为使用动态水位**

由于性能考虑，可以：
1. 对于单个 campaign 查询：使用动态水位
2. 对于全量统计：保持固定水位但添加注释说明

```typescript
// 在返回结果时添加说明
return {
  // ...
  campaigns: campaignStats.map(c => ({
    ...c,
    // 注意：此处使用固定水位进行快速判断
    // 精确的动态水位需要调用 checkStockLevel(userId, campaignId)
    needsReplenish: c.available < STOCK_CONFIG.LOW_WATERMARK,
    watermarkNote: 'Uses fixed watermark for performance. Call checkStockLevel for accurate dynamic watermark.',
  })),
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/lib/stock-producer.ts
git commit -m "docs: clarify watermark usage in getStockStats"
```

---

### Task 11: 添加 API Key 迁移日志

**问题:** API Key 从明文迁移到哈希时没有日志记录

**Files:**
- Modify: `src/lib/auth.ts:216-226`

**Step 1: 阅读当前实现**

查看 API Key 验证和迁移逻辑。

**Step 2: 添加审计日志**

```typescript
// 兼容旧数据：如果数据库里存的是明文，自动迁移为哈希
if (user.apiKeyHash === apiKey) {
  console.log(`[Auth] Migrating plaintext API key to hash for user ${user.id}`)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        apiKeyHash,
        apiKeyPrefix: apiKey.substring(0, 12),
        apiKeyCreatedAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'API_KEY_MIGRATED',
        details: JSON.stringify({
          reason: 'Automatic migration from plaintext to hashed storage',
          timestamp: new Date().toISOString(),
        }),
      },
    }),
  ])

  console.log(`[Auth] API key migration completed for user ${user.id}`)
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/lib/auth.ts
git commit -m "security: add audit logging for API key migration"
```

---

### Task 12: 改进错误日志上下文

**问题:** 错误日志缺少上下文信息，难以调试

**Files:**
- Modify: `src/app/api/v1/suffix/lease/route.ts`
- Modify: `src/app/api/v1/suffix/ack/route.ts`

**Step 1: 改进错误日志格式**

```typescript
} catch (error) {
  const errorContext = {
    userId: user?.id,
    campaignId: body?.campaignId,
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }
  console.error('[Lease] Error:', JSON.stringify(errorContext, null, 2))
  return errorResponse('INTERNAL_ERROR', '服务内部错误，请稍后重试', 500)
}
```

**Step 2: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 3: Commit**

```bash
git add src/app/api/v1/suffix/lease/route.ts src/app/api/v1/suffix/ack/route.ts
git commit -m "improve: add context to error logs for better debugging"
```

---

## 阶段四：安全加固（Medium Priority）

### Task 13: 添加 URL 输入验证

**问题:** 联盟链接 URL 缺少验证

**Files:**
- Modify: `src/lib/suffix-generator.ts`

**Step 1: 添加 URL 验证函数**

```typescript
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}
```

**Step 2: 在使用前验证 URL**

```typescript
if (!affiliateUrl || !isValidUrl(affiliateUrl)) {
  console.error(`[SuffixGenerator] Invalid affiliate URL: ${affiliateUrl}`)
  return null
}
```

**Step 3: 验证修改**

Run: `npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/lib/suffix-generator.ts
git commit -m "security: add URL validation for affiliate links"
```

---

## 任务总结

| 阶段 | 任务 | 优先级 | 预计时间 |
|------|------|--------|----------|
| 一 | Task 1: 修复失败租约库存回收 | Critical | 3 min |
| 一 | Task 2: 修复批量 Ack 库存回收 | Critical | 3 min |
| 一 | Task 3: 添加租约回收定时任务 | Critical | 5 min |
| 一 | Task 4: 添加库存清理定时任务 | Critical | 3 min |
| 二 | Task 5: 添加数据库索引 | High | 5 min |
| 二 | Task 6: 优化代理 IP 检测 | High | 5 min |
| 二 | Task 7: 优化 Campaign 查询 | High | 5 min |
| 三 | Task 8: 统一 Lease 处理逻辑 | Medium | 5 min |
| 三 | Task 9: 统一 Ack 处理逻辑 | Medium | 5 min |
| 三 | Task 10: 修复 getStockStats 水位 | Medium | 3 min |
| 三 | Task 11: 添加 API Key 迁移日志 | Medium | 3 min |
| 三 | Task 12: 改进错误日志上下文 | Medium | 3 min |
| 四 | Task 13: 添加 URL 输入验证 | Medium | 3 min |

**总计:** 13 个任务，约 50 分钟
