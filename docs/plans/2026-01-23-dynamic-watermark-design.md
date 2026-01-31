# 动态低水位策略设计

**日期**: 2026-01-23
**状态**: 已批准
**作者**: Claude Code

## 概述

将固定的库存低水位阈值（`LOW_WATERMARK = 3`）替换为基于历史消费速率的动态计算，使库存水位自适应流量变化，减少库存浪费和不必要的补货。

## 目标

### 主要目标
- 根据过去 24 小时的实际消费情况自动调整库存水位
- 高流量 campaign 自动提高水位，避免频繁补货
- 低流量 campaign 自动降低水位，减少库存积压
- 保持系统稳定性和性能

### 非目标
- 不支持手动配置每个 campaign 的水位（保持自动化）
- 不改变补货批次大小（`PRODUCE_BATCH_SIZE = 10`）
- 不影响现有 API 接口

## 核心逻辑

### 计算公式

```typescript
// 1. 统计过去 24 小时的消费数量
const consumed24h = count(status='consumed', consumedAt >= now-24h)

// 2. 计算每小时平均消费
const avgPerHour = consumed24h / 24

// 3. 动态水位 = 2倍安全系数（至少2小时缓冲）
const dynamicWatermark = Math.max(3, Math.ceil(avgPerHour * 2))

// 4. 应用上限（防止异常）
const finalWatermark = Math.min(dynamicWatermark, 20)
```

### 边缘情况处理

| 场景 | 处理策略 | 返回水位 |
|------|---------|---------|
| 新 campaign（无消费历史） | 使用默认值 | 5 |
| 过去 24h 消费为 0 | 使用最低值 | 3 |
| 正常消费 | 按公式计算 | 3-20 |
| 异常高流量 | 应用上限 | 20 |

### 示例计算

| 24h 消费量 | 每小时平均 | 计算结果 | 最终水位 |
|-----------|-----------|---------|---------|
| 0 | 0 | 3 (最低) | 3 |
| 12 | 0.5 | 3 (最低) | 3 |
| 48 | 2 | 4 | 4 |
| 120 | 5 | 10 | 10 |
| 300 | 12.5 | 25 → 20 (上限) | 20 |

## 实现方案

### 修改文件

1. **`src/lib/utils.ts`** - 添加动态水位配置常量
2. **`src/lib/stock-producer.ts`** - 添加计算函数，修改检查逻辑

### 新增配置（`src/lib/utils.ts`）

```typescript
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

### 新增函数（`src/lib/stock-producer.ts`）

```typescript
/**
 * 计算 campaign 的动态低水位
 * 基于过去 24 小时的消费速率
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
    // 1. 查询过去 24 小时的消费数量
    const windowStart = new Date(
      Date.now() - DYNAMIC_WATERMARK_CONFIG.HISTORY_WINDOW_HOURS * 60 * 60 * 1000
    )

    const consumed24h = await prisma.suffixStockItem.count({
      where: {
        userId,
        campaignId,
        status: 'consumed',
        consumedAt: { gte: windowStart },
        deletedAt: null,
      },
    })

    // 2. 新 campaign（无消费历史）
    if (consumed24h === 0) {
      return DYNAMIC_WATERMARK_CONFIG.DEFAULT_WATERMARK
    }

    // 3. 计算动态水位
    const avgPerHour = consumed24h / DYNAMIC_WATERMARK_CONFIG.HISTORY_WINDOW_HOURS
    const dynamicWatermark = Math.ceil(avgPerHour * DYNAMIC_WATERMARK_CONFIG.SAFETY_FACTOR)

    // 4. 应用边界
    const finalWatermark = Math.max(
      DYNAMIC_WATERMARK_CONFIG.MIN_WATERMARK,
      Math.min(dynamicWatermark, DYNAMIC_WATERMARK_CONFIG.MAX_WATERMARK)
    )

    // 5. 记录日志
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

### 修改现有函数

**`checkStockLevel()` 函数：**

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

**`replenishCampaign()` 函数：**

```typescript
// 在日志消息中使用动态水位
const { availableCount, needsReplenish, deficit, watermark } = await checkStockLevel(userId, campaignId)

if (!needsReplenish && !forceReplenish) {
  return {
    // ...
    message: `库存充足（${availableCount} >= ${watermark}）`,  // 使用动态水位
  }
}
```

**`getStockStats()` 函数：**

```typescript
// 在返回的统计信息中增加当前水位
const campaigns = Array.from(campaignMap.values()).map(c => ({
  ...c,
  total: c.available + c.leased + c.consumed,
  needsReplenish: c.available < STOCK_CONFIG.LOW_WATERMARK,  // 暂时保持固定值
  // TODO: 异步计算每个 campaign 的动态水位（性能优化）
}))
```

## 影响范围

### 修改的函数
- `checkStockLevel()` - 从固定水位改为动态计算
- `replenishCampaign()` - 日志消息使用动态水位
- `getStockStats()` - 未来可增加水位显示

### 不受影响的函数
- `triggerReplenishAsync()` - 自动继承新逻辑
- `replenishAllLowStock()` - 自动继承新逻辑
- 所有 API 路由 - 无需修改

### 向后兼容
- 保留 `STOCK_CONFIG.LOW_WATERMARK = 3` 作为全局最低值
- 如果动态计算失败（数据库错误），回退到固定水位 3
- 不影响现有 API 接口和响应格式

## 性能考虑

### 数据库查询
- 每次 `checkStockLevel()` 增加 1 次 COUNT 查询
- 查询条件：`(userId, campaignId, status, consumedAt, deletedAt)`
- 需要确保索引存在：`idx_suffix_stock_consumption`

### 预期性能
- 单次查询耗时：< 10ms
- 对现有流程影响：可忽略
- 补货频率：不变（仍由水位触发）

### 优化建议（未来）
- 如果性能成为瓶颈，可考虑缓存水位值（5 分钟 TTL）
- 或使用定时任务预计算所有 campaign 的水位

## 测试策略

### 单元测试

测试 `calculateDynamicWatermark()` 函数：

```typescript
describe('calculateDynamicWatermark', () => {
  it('新 campaign 返回默认水位 5', async () => {
    // 模拟无消费历史
    const watermark = await calculateDynamicWatermark(userId, campaignId)
    expect(watermark).toBe(5)
  })

  it('零消费返回最低水位 3', async () => {
    // 模拟 24h 消费 0 条
    const watermark = await calculateDynamicWatermark(userId, campaignId)
    expect(watermark).toBe(3)
  })

  it('正常消费计算正确', async () => {
    // 模拟 24h 消费 48 条 → avgPerHour=2 → watermark=4
    const watermark = await calculateDynamicWatermark(userId, campaignId)
    expect(watermark).toBe(4)
  })

  it('高流量应用上限 20', async () => {
    // 模拟 24h 消费 300 条 → 计算结果 25 → 上限 20
    const watermark = await calculateDynamicWatermark(userId, campaignId)
    expect(watermark).toBe(20)
  })

  it('数据库错误回退到最低水位', async () => {
    // 模拟数据库查询失败
    const watermark = await calculateDynamicWatermark(userId, campaignId)
    expect(watermark).toBe(3)
  })
})
```

### 集成测试

测试 `checkStockLevel()` 和 `replenishCampaign()`：

```typescript
describe('Dynamic Watermark Integration', () => {
  it('动态水位正确触发补货', async () => {
    // 1. 创建测试 campaign，模拟高消费（24h 消费 120 条）
    // 2. 当前库存 8 条
    // 3. 动态水位应为 10
    // 4. 应触发补货（8 < 10）

    const { needsReplenish, watermark } = await checkStockLevel(userId, campaignId)
    expect(watermark).toBe(10)
    expect(needsReplenish).toBe(true)
  })

  it('低流量不触发补货', async () => {
    // 1. 创建测试 campaign，模拟低消费（24h 消费 12 条）
    // 2. 当前库存 5 条
    // 3. 动态水位应为 3
    // 4. 不应触发补货（5 >= 3）

    const { needsReplenish, watermark } = await checkStockLevel(userId, campaignId)
    expect(watermark).toBe(3)
    expect(needsReplenish).toBe(false)
  })
})
```

### 手动测试

1. **创建测试 campaign**
   - 使用 API 创建新 campaign
   - 验证初始水位为 5（默认值）

2. **模拟不同消费速率**
   - 手动创建 consumed 状态的 stock items
   - 设置不同的 consumedAt 时间戳
   - 调用 `checkStockLevel()` 验证水位计算

3. **观察补货行为**
   - 触发 `replenishCampaign()`
   - 检查日志中的水位值
   - 验证补货是否按预期触发

## 监控与可观测性

### 日志记录

在 `calculateDynamicWatermark()` 中添加详细日志：

```typescript
console.log(
  `[DynamicWatermark] ${campaignId}: ` +
  `consumed24h=${consumed24h}, ` +
  `avgPerHour=${avgPerHour.toFixed(2)}, ` +
  `watermark=${finalWatermark}`
)
```

### 统计指标

在 `getStockStats()` 返回中增加字段：

```typescript
{
  campaigns: [{
    // ... 现有字段
    currentWatermark: number,  // 新增：当前动态水位
  }],
  // ...
}
```

### Dashboard 显示

在库存管理页面显示：
- 每个 campaign 的当前水位值
- 24 小时消费趋势
- 水位变化历史（可选）

## 上线计划

### 阶段 1：开发与测试（1-2 天）
1. 实现代码
2. 编写单元测试
3. 本地验证

### 阶段 2：测试环境验证（1-2 天）
1. 部署到测试环境
2. 创建测试数据
3. 观察水位计算和补货行为

### 阶段 3：生产环境上线（1 周）
1. 部署到生产环境
2. 监控日志和性能指标
3. 观察库存水位变化
4. 收集用户反馈

### 阶段 4：稳定与优化（持续）
1. 根据实际运行数据调整参数
2. 优化性能（如需要）
3. 考虑未来增强功能

## 未来优化方向

### 短期（1-3 个月）
- 支持环境变量配置安全系数和上限
- 在 Dashboard 显示水位趋势图
- 添加水位异常告警

### 中期（3-6 个月）
- 支持不同时间窗口（12h/48h/7d）
- 基于星期几的流量模式识别
- 支持手动覆盖特定 campaign 的水位

### 长期（6+ 个月）
- 机器学习预测流量趋势
- 自动调整安全系数
- 多维度水位策略（按国家、时段等）

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 数据库查询性能下降 | 中 | 确保索引存在；监控查询耗时；必要时添加缓存 |
| 新 campaign 水位不准确 | 低 | 使用保守的默认值 5；随着消费数据积累自动调整 |
| 异常流量导致过度补货 | 低 | 设置上限 20；监控补货频率 |
| 计算错误导致库存不足 | 中 | 错误时回退到最低水位 3；保留定时批量补货兜底 |

## 成功指标

- 高流量 campaign 的补货频率降低 30%+
- 低流量 campaign 的库存积压减少 50%+
- 系统整体库存利用率提升 20%+
- 无因水位调整导致的库存不足事件
- 查询性能影响 < 5%

## 参考资料

- 原始需求讨论：库存优化方向分析
- 相关代码：`src/lib/stock-producer.ts`
- 相关配置：`src/lib/utils.ts` - `STOCK_CONFIG`
