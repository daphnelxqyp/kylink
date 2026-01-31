# 动态低水位策略实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现基于过去 24 小时消费速率的动态库存水位计算，替换固定的 LOW_WATERMARK = 3

**Architecture:** 在 stock-producer.ts 中添加 calculateDynamicWatermark() 函数，实时查询数据库计算动态水位。修改 checkStockLevel() 函数使用动态水位替代固定值。保持向后兼容，错误时回退到最低水位 3。

**Tech Stack:** TypeScript, Prisma ORM, Next.js 14

---

## Task 1: 添加动态水位配置常量

**Files:**
- Modify: `src/lib/utils.ts:99` (在 STOCK_CONFIG 后添加)

**Step 1: 添加 DYNAMIC_WATERMARK_CONFIG 常量**

在 `src/lib/utils.ts` 的 STOCK_CONFIG 定义后添加：

```typescript
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
```

**Step 2: 验证配置已添加**

运行 TypeScript 检查：
```bash
npx tsc --noEmit
```

预期：无类型错误

**Step 3: 提交配置常量**

```bash
git add src/lib/utils.ts
git commit -m "feat: add dynamic watermark configuration constants

- Add DYNAMIC_WATERMARK_CONFIG with history window, safety factor, and limits
- Prepare for dynamic watermark calculation implementation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: 实现 calculateDynamicWatermark 函数

**Files:**
- Modify: `src/lib/stock-producer.ts:60` (在 generateMockSuffix 函数前添加)

**Step 1: 导入新配置**

在 `src/lib/stock-producer.ts` 的导入部分，修改：

```typescript
import { STOCK_CONFIG, DYNAMIC_WATERMARK_CONFIG } from './utils'
```

**Step 2: 添加 calculateDynamicWatermark 函数**

在 `generateMockSuffix` 函数之前添加：

```typescript
/**
 * 计算 campaign 的动态低水位
 * 基于过去 24 小时的消费速率
 *
 * 算法：
 * 1. 统计过去 24h 消费数量
 * 2. 计算每小时平均消费 = consumed24h / 24
 * 3. 动态水位 = ceil(avgPerHour * 2) 至少 2 小时缓冲
 * 4. 应用边界：最低 3，最高 20
 *
 * 边缘情况：
 * - 新 campaign（无消费历史）→ 返回默认水位 5
 * - 数据库错误 → 返回最低水位 3
 *
 * @param userId 用户 ID
 * @param campaignId Campaign ID
 * @returns 动态计算的水位值（3-20）
 */
export async function calculateDynamicWatermark(
  userId: string,
  campaignId: string
): Promise<number> {
  try {
    // 1. 计算时间窗口起点
    const windowStart = new Date(
      Date.now() - DYNAMIC_WATERMARK_CONFIG.HISTORY_WINDOW_HOURS * 60 * 60 * 1000
    )

    // 2. 查询过去 24 小时的消费数量
    const consumed24h = await prisma.suffixStockItem.count({
      where: {
        userId,
        campaignId,
        status: 'consumed',
        consumedAt: { gte: windowStart },
        deletedAt: null,
      },
    })

    // 3. 新 campaign（无消费历史）
    if (consumed24h === 0) {
      console.log(
        `[DynamicWatermark] ${campaignId}: No consumption history, using default watermark ${DYNAMIC_WATERMARK_CONFIG.DEFAULT_WATERMARK}`
      )
      return DYNAMIC_WATERMARK_CONFIG.DEFAULT_WATERMARK
    }

    // 4. 计算动态水位
    const avgPerHour = consumed24h / DYNAMIC_WATERMARK_CONFIG.HISTORY_WINDOW_HOURS
    const dynamicWatermark = Math.ceil(avgPerHour * DYNAMIC_WATERMARK_CONFIG.SAFETY_FACTOR)

    // 5. 应用边界
    const finalWatermark = Math.max(
      DYNAMIC_WATERMARK_CONFIG.MIN_WATERMARK,
      Math.min(dynamicWatermark, DYNAMIC_WATERMARK_CONFIG.MAX_WATERMARK)
    )

    // 6. 记录日志
    console.log(
      `[DynamicWatermark] ${campaignId}: consumed24h=${consumed24h}, ` +
      `avgPerHour=${avgPerHour.toFixed(2)}, watermark=${finalWatermark}`
    )

    return finalWatermark

  } catch (error) {
    console.error(`[DynamicWatermark] Error calculating for ${campaignId}:`, error)
    // 出错时回退到固定最低水位
    return DYNAMIC_WATERMARK_CONFIG.MIN_WATERMARK
  }
}
```

**Step 3: 验证函数已添加**

运行 TypeScript 检查：
```bash
npx tsc --noEmit
```

预期：无类型错误

**Step 4: 提交函数实现**

```bash
git add src/lib/stock-producer.ts
git commit -m "feat: implement calculateDynamicWatermark function

- Calculate watermark based on 24h consumption rate
- Handle edge cases: new campaigns, zero consumption, errors
- Apply safety factor (2x) and boundaries (3-20)
- Add detailed logging for observability

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: 修改 checkStockLevel 使用动态水位

**Files:**
- Modify: `src/lib/stock-producer.ts:64-91` (checkStockLevel 函数)

**Step 1: 更新 checkStockLevel 返回类型**

修改函数签名，添加 watermark 字段：

```typescript
export async function checkStockLevel(
  userId: string,
  campaignId: string
): Promise<{
  availableCount: number
  needsReplenish: boolean
  deficit: number
  watermark: number  // 新增：返回当前使用的水位
}> {
```

**Step 2: 使用动态水位替换固定值**

修改函数体：

```typescript
export async function checkStockLevel(
  userId: string,
  campaignId: string
): Promise<{
  availableCount: number
  needsReplenish: boolean
  deficit: number
  watermark: number
}> {
  const availableCount = await prisma.suffixStockItem.count({
    where: {
      userId,
      campaignId,
      status: 'available',
      deletedAt: null,
    },
  })

  // 动态计算水位（替换固定的 STOCK_CONFIG.LOW_WATERMARK）
  const watermark = await calculateDynamicWatermark(userId, campaignId)

  const needsReplenish = availableCount < watermark
  const deficit = needsReplenish
    ? STOCK_CONFIG.PRODUCE_BATCH_SIZE - availableCount
    : 0

  return {
    availableCount,
    needsReplenish,
    deficit,
    watermark,  // 新增：返回水位值
  }
}
```

**Step 3: 验证修改**

运行 TypeScript 检查：
```bash
npx tsc --noEmit
```

预期：无类型错误

**Step 4: 提交修改**

```bash
git add src/lib/stock-producer.ts
git commit -m "feat: use dynamic watermark in checkStockLevel

- Replace fixed LOW_WATERMARK with calculateDynamicWatermark()
- Add watermark field to return type for observability
- Maintain backward compatibility with existing callers

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: 更新 replenishCampaign 使用动态水位

**Files:**
- Modify: `src/lib/stock-producer.ts:96-235` (replenishCampaign 函数)

**Step 1: 更新 checkStockLevel 调用**

修改第 103 行，解构新增的 watermark 字段：

```typescript
// 1. 检查当前库存水位
const { availableCount, needsReplenish, deficit, watermark } = await checkStockLevel(userId, campaignId)
```

**Step 2: 更新日志消息使用动态水位**

修改第 114 行的消息：

```typescript
if (!needsReplenish && !forceReplenish) {
  return {
    campaignId,
    userId,
    previousCount: availableCount,
    producedCount: 0,
    currentCount: availableCount,
    status: 'skipped',
    message: `库存充足（${availableCount} >= ${watermark}）`,  // 使用动态水位
  }
}
```

**Step 3: 验证修改**

运行 TypeScript 检查：
```bash
npx tsc --noEmit
```

预期：无类型错误

**Step 4: 提交修改**

```bash
git add src/lib/stock-producer.ts
git commit -m "feat: update replenishCampaign to use dynamic watermark

- Use watermark from checkStockLevel result
- Update log messages to show actual watermark used
- Improve observability of replenishment decisions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: 更新 getStockStats 显示水位信息

**Files:**
- Modify: `src/lib/stock-producer.ts:329-407` (getStockStats 函数)

**Step 1: 添加注释说明未来优化**

在第 395 行的 needsReplenish 计算处添加注释：

```typescript
// 转换为数组并计算总计
const campaigns = Array.from(campaignMap.values()).map(c => ({
  ...c,
  total: c.available + c.leased + c.consumed,
  // 注意：这里仍使用固定水位进行快速判断
  // 如需精确的动态水位，需要为每个 campaign 调用 calculateDynamicWatermark
  // 考虑性能影响，暂时保持固定值
  needsReplenish: c.available < STOCK_CONFIG.LOW_WATERMARK,
}))
```

**Step 2: 验证修改**

运行 TypeScript 检查：
```bash
npx tsc --noEmit
```

预期：无类型错误

**Step 3: 提交修改**

```bash
git add src/lib/stock-producer.ts
git commit -m "docs: add comment about dynamic watermark in getStockStats

- Explain why fixed watermark is still used in stats
- Note future optimization opportunity
- Maintain current performance characteristics

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: 验证构建和类型检查

**Files:**
- None (verification only)

**Step 1: 运行完整的 TypeScript 检查**

```bash
npx tsc --noEmit
```

预期：无类型错误（忽略预存在的 affiliate-networks/sync/route.ts 错误）

**Step 2: 运行 ESLint 检查**

```bash
npm run lint
```

预期：无新增 lint 错误

**Step 3: 尝试构建项目**

```bash
npm run build
```

预期：构建成功（可能因预存在错误失败，但我们的代码应该编译通过）

**Step 4: 记录验证结果**

如果所有检查通过，继续下一步。如果有错误，修复后重新验证。

---

## Task 7: 手动测试动态水位计算

**Files:**
- None (manual testing)

**Step 1: 启动开发服务器**

```bash
npm run dev
```

预期：服务器在端口 51001 启动

**Step 2: 测试场景 1 - 新 campaign（无历史）**

使用 API 或数据库直接创建一个新的 campaign，然后调用补货：

观察日志输出：
```
[DynamicWatermark] campaign-123: No consumption history, using default watermark 5
```

预期水位：5

**Step 3: 测试场景 2 - 低消费 campaign**

创建测试数据：过去 24h 消费 12 条

观察日志输出：
```
[DynamicWatermark] campaign-456: consumed24h=12, avgPerHour=0.50, watermark=3
```

预期水位：3（最低）

**Step 4: 测试场景 3 - 中等消费 campaign**

创建测试数据：过去 24h 消费 48 条

观察日志输出：
```
[DynamicWatermark] campaign-789: consumed24h=48, avgPerHour=2.00, watermark=4
```

预期水位：4

**Step 5: 测试场景 4 - 高消费 campaign**

创建测试数据：过去 24h 消费 120 条

观察日志输出：
```
[DynamicWatermark] campaign-abc: consumed24h=120, avgPerHour=5.00, watermark=10
```

预期水位：10

**Step 6: 测试场景 5 - 异常高消费（触发上限）**

创建测试数据：过去 24h 消费 300 条

观察日志输出：
```
[DynamicWatermark] campaign-def: consumed24h=300, avgPerHour=12.50, watermark=20
```

预期水位：20（上限）

**Step 7: 记录测试结果**

确认所有场景的水位计算符合预期。

---

## Task 8: 测试补货触发逻辑

**Files:**
- None (manual testing)

**Step 1: 测试低水位触发补货**

场景：
- Campaign 动态水位为 10
- 当前可用库存为 8 条
- 预期：触发补货

观察日志：
```
[DynamicWatermark] campaign-xxx: consumed24h=120, avgPerHour=5.00, watermark=10
[Stock] Async replenish for campaign-xxx: +10
```

**Step 2: 测试高水位不触发补货**

场景：
- Campaign 动态水位为 3
- 当前可用库存为 5 条
- 预期：不触发补货

观察日志：
```
[DynamicWatermark] campaign-yyy: consumed24h=12, avgPerHour=0.50, watermark=3
库存充足（5 >= 3）
```

**Step 3: 测试批量补货**

调用 `/api/v1/jobs/replenish` 端点或直接调用 `replenishAllLowStock()`

观察：
- 每个 campaign 都使用各自的动态水位
- 日志显示不同的水位值

**Step 4: 记录测试结果**

确认补货逻辑正确使用动态水位。

---

## Task 9: 性能验证

**Files:**
- None (performance testing)

**Step 1: 测量单次水位计算耗时**

在 `calculateDynamicWatermark` 函数中添加临时计时代码：

```typescript
const startTime = Date.now()
const consumed24h = await prisma.suffixStockItem.count(...)
const queryTime = Date.now() - startTime
console.log(`[Performance] Watermark query took ${queryTime}ms`)
```

**Step 2: 执行多次测试**

触发 10 次补货检查，记录查询耗时

预期：每次查询 < 10ms

**Step 3: 检查数据库索引**

确认 SuffixStockItem 表有以下索引：
- `(userId, campaignId, status, consumedAt, deletedAt)`

如果没有，考虑添加（但不在本计划范围内）

**Step 4: 移除临时计时代码**

删除添加的性能测试代码

**Step 5: 记录性能结果**

确认性能影响可接受（< 10ms per query）

---

## Task 10: 最终验证和文档更新

**Files:**
- Modify: `CLAUDE.md` (可选，更新关键业务规则)

**Step 1: 运行完整测试套件**

```bash
npm run build
npm run lint
```

预期：无新增错误

**Step 2: 验证所有提交**

```bash
git log --oneline -10
```

确认所有 8 个提交都已完成

**Step 3: 更新 CLAUDE.md（可选）**

在"关键业务规则"部分添加：

```markdown
6. **动态库存水位**：库存低水位基于过去 24 小时消费速率动态计算（最低 3，最高 20）
```

**Step 4: 创建最终提交（如果更新了文档）**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with dynamic watermark rule

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

**Step 5: 实现完成**

所有任务已完成，动态低水位策略已成功实现。

---

## 验收标准

- [ ] `DYNAMIC_WATERMARK_CONFIG` 常量已添加到 `src/lib/utils.ts`
- [ ] `calculateDynamicWatermark()` 函数已实现并正确处理所有边缘情况
- [ ] `checkStockLevel()` 使用动态水位并返回 watermark 字段
- [ ] `replenishCampaign()` 日志显示实际使用的动态水位
- [ ] TypeScript 编译无错误
- [ ] 手动测试验证 5 种场景的水位计算正确
- [ ] 补货逻辑正确使用动态水位触发
- [ ] 性能影响可接受（< 10ms per query）
- [ ] 所有代码已提交到 git

## 回滚计划

如果需要回滚：

1. 恢复 `checkStockLevel()` 使用固定的 `STOCK_CONFIG.LOW_WATERMARK`
2. 保留 `calculateDynamicWatermark()` 函数但不调用
3. 保留配置常量以便将来重新启用

## 未来优化

- 添加环境变量控制动态水位开关
- 在 Dashboard 显示每个 campaign 的当前水位
- 添加水位变化趋势图
- 支持自定义时间窗口（12h/48h）
- 基于星期几的流量模式识别
