# 换链监控模块重构设计方案

**日期**：2026-02-05
**作者**：Claude Sonnet 4.5
**状态**：待实施

## 概述

重构"换链监控"模块，优化统计卡片和列表展示，增强数据可见性和用户体验。

### 核心目标

1. 新增"总广告系列"统计卡片，显示启用了联盟链接的 Campaign 总数
2. 列表展示所有启用了联盟链接的 Campaign（而非仅今日有换链活动的）
3. 新增"最后监控时间"列，显示脚本最后一次上报点击数的时间
4. "今日点击"数据来源改为脚本直接上报（而非后端计算）
5. 优化默认排序和分页设置

## 需求明细

### 统计卡片（4 个）

| 卡片 | 数据来源 | 说明 |
|------|---------|------|
| 总广告系列 | `AffiliateLink` 表（`enabled=true`）去重 | 仅统计启用了联盟链接的 Campaign |
| 今日点击总数 | 所有启用了联盟链接的 Campaign 的 `todayClicks` 之和 | 来自脚本上报 |
| 今日换链次数 | 今日 `SuffixAssignment` 记录总数 | 今日所有换链次数 |
| 换链成功率 | 今日成功次数 / 今日换链次数 | 百分比，保留 1 位小数 |

### 列表展示

**显示范围**：所有启用了联盟链接的 Campaign

**列定义**：

| 列名 | 数据来源 | 说明 |
|------|---------|------|
| 广告系列名称 | `CampaignMeta.campaignName` | 无名称时显示 Campaign ID |
| Campaign ID | `CampaignMeta.campaignId` | - |
| 今日点击 | `CampaignClickState.todayClicks` | 脚本上报的今日点击数 |
| 换链次数 | 今日 `SuffixAssignment` 记录数 | 今日该 Campaign 的换链次数 |
| 成功 | 今日 `SuffixWriteLog` 中 `writeSuccess=true` 的记录数 | 绿色文字 |
| 失败 | 今日 `SuffixWriteLog` 中 `writeSuccess=false` 的记录数 | 红色标签 |
| 成功率 | 成功 / 换链次数 | 今日无换链时显示 "-" |
| 最后换链时间 | `SuffixAssignment.assignedAt` 最大值（历史） | 无记录时显示 "-" |
| 最后监控时间 | `CampaignClickState.updatedAt` | 脚本最后一次上报时间 |

**排序和分页**：
- 默认排序：按"最后监控时间"降序
- 默认分页：每页 50 条
- 支持所有列排序

## 技术设计

### 1. 数据库 Schema 变更

**修改 `prisma/schema.prisma`：**

```prisma
model CampaignClickState {
  id                  String   @id @default(uuid()) @db.Char(36)
  userId              String   @db.Char(36)
  campaignId          String
  lastObservedClicks  Int      @default(0)
  lastAppliedClicks   Int      @default(0)
  todayClicks         Int      @default(0)  // 新增：今日点击数
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([userId, campaignId])
  @@index([userId])
  @@map("campaign_click_states")
}
```

**迁移策略**：
- 开发环境：`npm run db:push`
- 生产环境：添加字段时设置默认值 0，确保现有数据兼容
- 历史数据的 `todayClicks` 保持为 0，不影响监控页面（只关注今日数据）

### 2. Google Ads 脚本修改

**文件**：`campaignto1.js`

**修改位置 1**：获取今日点击数（约第 180-200 行）

```javascript
// 当前代码
const nowClicks = campaign.getStatsFor('ALL_TIME').getClicks();

// 修改为
const nowClicks = campaign.getStatsFor('ALL_TIME').getClicks();
const todayClicks = campaign.getStatsFor('TODAY').getClicks();  // 新增

// 添加到数据对象
needsChangeList.push({
  campaign: campaign,
  campaignId: campaignId,
  nowClicks: nowClicks,
  todayClicks: todayClicks,  // 新增
  // ... 其他字段
});
```

**修改位置 2**：批量请求数据构建（约第 200-220 行）

```javascript
// 当前代码
const batchRequests = needsChangeList.map(item => ({
  campaignId: item.campaignId,
  nowClicks: item.nowClicks,
  cid: item.cid,
  mccId: CONFIG.MCC_ACCOUNT_ID
}));

// 修改为
const batchRequests = needsChangeList.map(item => ({
  campaignId: item.campaignId,
  nowClicks: item.nowClicks,
  todayClicks: item.todayClicks,  // 新增
  cid: item.cid,
  mccId: CONFIG.MCC_ACCOUNT_ID
}));
```

**注意事项**：
- `getStatsFor('TODAY')` 返回当天 00:00 到当前时间的点击数
- Google Ads 自动处理时区（使用账户设置的时区）
- 不增加额外的 API 配额消耗

### 3. 后端 API 接口修改

**文件**：`src/lib/schemas.ts`

```typescript
// 单个请求 schema
export const suffixLeaseRequestSchema = z.object({
  campaignId: z.string().min(1),
  nowClicks: z.number().int().min(0),
  todayClicks: z.number().int().min(0).optional(),  // 新增：可选（兼容旧脚本）
  cid: z.string().min(1),
  mccId: z.string().optional(),
})

// 批量请求 schema
export const suffixLeaseBatchRequestSchema = z.object({
  requests: z.array(suffixLeaseRequestSchema).min(1).max(500),
})
```

**文件**：`src/lib/assignment-service.ts`

```typescript
// 在 assignSuffixForCampaign 函数中，更新 CampaignClickState
await prisma.campaignClickState.upsert({
  where: { userId_campaignId: { userId, campaignId } },
  create: {
    userId,
    campaignId,
    lastObservedClicks: nowClicks,
    lastAppliedClicks: nowClicks,
    todayClicks: todayClicks ?? 0,  // 新增
  },
  update: {
    lastObservedClicks: nowClicks,
    lastAppliedClicks: nowClicks,
    todayClicks: todayClicks ?? 0,  // 新增
    updatedAt: new Date(),
  },
})
```

**兼容性**：
- `todayClicks` 为可选参数，默认为 0
- 旧版本脚本仍可正常工作

### 4. 监控服务重构

**文件**：`src/lib/monitoring-service.ts`

**核心变化**：
- 从"只查询今日有换链活动的 Campaign"改为"查询所有启用了联盟链接的 Campaign"
- 新增"总广告系列"统计
- 新增"最后监控时间"字段

**查询逻辑**：

```typescript
export async function getLinkChangeMonitoring(userId: string): Promise<LinkChangeMonitoringData> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // 1. 查询所有启用了联盟链接的 Campaign
  const enabledCampaigns = await prisma.affiliateLink.findMany({
    where: {
      userId,
      enabled: true,
      deletedAt: null,
    },
    select: {
      campaignId: true,
    },
    distinct: ['campaignId'],
  })

  const campaignIds = enabledCampaigns.map(link => link.campaignId)

  // 2. 并行查询所有需要的数据
  const [assignments, writeLogs, clickStates, campaigns, historicalAssignments] = await Promise.all([
    // 今日分配记录
    prisma.suffixAssignment.groupBy({
      by: ['campaignId'],
      where: {
        userId,
        campaignId: { in: campaignIds },
        assignedAt: { gte: todayStart },
        deletedAt: null,
      },
      _count: { id: true },
    }),

    // 今日写入日志
    prisma.suffixWriteLog.groupBy({
      by: ['campaignId', 'writeSuccess'],
      where: {
        userId,
        campaignId: { in: campaignIds },
        reportedAt: { gte: todayStart },
        deletedAt: null,
      },
      _count: { id: true },
    }),

    // 点击状态（包含 todayClicks 和 updatedAt）
    prisma.campaignClickState.findMany({
      where: {
        userId,
        campaignId: { in: campaignIds },
      },
      select: {
        campaignId: true,
        todayClicks: true,
        updatedAt: true,
      },
    }),

    // Campaign 元数据
    prisma.campaignMeta.findMany({
      where: {
        userId,
        campaignId: { in: campaignIds },
        deletedAt: null,
      },
      select: {
        campaignId: true,
        campaignName: true,
      },
    }),

    // 历史最后一次换链时间（不限今日）
    prisma.suffixAssignment.groupBy({
      by: ['campaignId'],
      where: {
        userId,
        campaignId: { in: campaignIds },
        deletedAt: null,
      },
      _max: { assignedAt: true },
    }),
  ])

  // 3. 构建辅助 Map
  const clickStateMap = new Map(
    clickStates.map(cs => [cs.campaignId, {
      todayClicks: cs.todayClicks || 0,
      lastMonitoredAt: cs.updatedAt
    }])
  )

  const campaignNameMap = new Map(
    campaigns.map(c => [c.campaignId, c.campaignName])
  )

  const writeLogMap = new Map<string, { success: number; failure: number }>()
  for (const log of writeLogs) {
    if (!writeLogMap.has(log.campaignId)) {
      writeLogMap.set(log.campaignId, { success: 0, failure: 0 })
    }
    const stat = writeLogMap.get(log.campaignId)!
    if (log.writeSuccess) {
      stat.success = log._count.id
    } else {
      stat.failure = log._count.id
    }
  }

  const todayAssignmentMap = new Map(
    assignments.map(a => [a.campaignId, a._count.id])
  )

  const historicalAssignmentMap = new Map(
    historicalAssignments.map(a => [a.campaignId, a._max.assignedAt])
  )

  // 4. 为所有启用了联盟链接的 Campaign 构建统计数据
  const campaignStats: CampaignLinkChangeStat[] = campaignIds.map(campaignId => {
    const todayAssignments = todayAssignmentMap.get(campaignId) || 0
    const writeLog = writeLogMap.get(campaignId) || { success: 0, failure: 0 }
    const clickState = clickStateMap.get(campaignId) || { todayClicks: 0, lastMonitoredAt: null }

    // 成功率：今日无换链活动时为 null（前端显示 "-"）
    const successRate = todayAssignments > 0
      ? parseFloat(((writeLog.success / todayAssignments) * 100).toFixed(1))
      : null

    return {
      campaignId,
      campaignName: campaignNameMap.get(campaignId) || null,
      todayClicks: clickState.todayClicks,
      todayAssignments,
      successCount: writeLog.success,
      failureCount: writeLog.failure,
      successRate,
      lastAssignedAt: historicalAssignmentMap.get(campaignId) || null,
      lastMonitoredAt: clickState.lastMonitoredAt,
    }
  })

  // 5. 计算全局汇总统计
  const summary = {
    totalCampaigns: campaignIds.length,
    totalClicks: campaignStats.reduce((sum, stat) => sum + stat.todayClicks, 0),
    totalAssignments: campaignStats.reduce((sum, stat) => sum + stat.todayAssignments, 0),
    totalSuccess: campaignStats.reduce((sum, stat) => sum + stat.successCount, 0),
    successRate: 0,
  }

  summary.successRate = summary.totalAssignments > 0
    ? parseFloat(((summary.totalSuccess / summary.totalAssignments) * 100).toFixed(1))
    : 0

  return { summary, campaigns: campaignStats }
}
```

### 5. 类型定义修改

**文件**：`src/types/monitoring.ts`

```typescript
/**
 * Campaign 换链统计
 */
export interface CampaignLinkChangeStat {
  campaignId: string
  campaignName: string | null
  todayClicks: number              // 今日点击数（来自脚本上报）
  todayAssignments: number         // 今日换链次数
  successCount: number             // 成功次数
  failureCount: number             // 失败次数
  successRate: number | null       // 成功率（今日无换链时为 null）
  lastAssignedAt: Date | null      // 最后换链时间（历史）
  lastMonitoredAt: Date | null     // 新增：最后监控时间
}

/**
 * 全局汇总统计
 */
export interface LinkChangeSummary {
  totalCampaigns: number           // 新增：总广告系列数
  totalClicks: number              // 今日总点击数
  totalAssignments: number         // 今日总换链次数
  totalSuccess: number             // 今日总成功次数
  successRate: number              // 今日成功率（百分比）
}

/**
 * 换链监控响应数据
 */
export interface LinkChangeMonitoringData {
  summary: LinkChangeSummary
  campaigns: CampaignLinkChangeStat[]
}

/**
 * API 响应格式
 */
export interface LinkChangeMonitoringResponse {
  success: true
  data: LinkChangeMonitoringData
}
```

### 6. 前端页面修改

**文件**：`src/app/(dashboard)/monitoring/page.tsx`

**统计卡片调整**：

```typescript
<Row gutter={[16, 16]}>
  {/* 新增：总广告系列 */}
  <Col xs={24} sm={12} lg={6}>
    <Card>
      <Statistic
        title="总广告系列"
        value={summary?.totalCampaigns || 0}
        suffix="个"
        prefix={<DatabaseOutlined />}
        valueStyle={{ color: '#13c2c2' }}
      />
    </Card>
  </Col>

  <Col xs={24} sm={12} lg={6}>
    <Card>
      <Statistic
        title="今日点击总数"
        value={summary?.totalClicks || 0}
        prefix={<LineChartOutlined />}
        valueStyle={{ color: '#1890ff' }}
      />
    </Card>
  </Col>

  <Col xs={24} sm={12} lg={6}>
    <Card>
      <Statistic
        title="今日换链次数"
        value={summary?.totalAssignments || 0}
        prefix={<SwapOutlined />}
        valueStyle={{ color: '#fa8c16' }}
      />
    </Card>
  </Col>

  <Col xs={24} sm={12} lg={6}>
    <Card>
      <Statistic
        title="换链成功率"
        value={summary?.successRate || 0}
        suffix="%"
        prefix={<PercentageOutlined />}
        valueStyle={{ color: '#52c41a' }}
        precision={1}
      />
    </Card>
  </Col>
</Row>
```

**表格列定义调整**：

```typescript
columns={[
  {
    title: '广告系列名称',
    dataIndex: 'campaignName',
    width: 250,
    ellipsis: true,
    render: (name: string | null, record) => (
      <Text ellipsis style={{ maxWidth: 230 }} title={name || record.campaignId}>
        {name || <Text type="secondary">{record.campaignId}</Text>}
      </Text>
    ),
  },
  {
    title: 'Campaign ID',
    dataIndex: 'campaignId',
    width: 130,
  },
  {
    title: '今日点击',
    dataIndex: 'todayClicks',
    width: 90,
    sorter: (a, b) => a.todayClicks - b.todayClicks,
  },
  {
    title: '换链次数',
    dataIndex: 'todayAssignments',
    width: 90,
    sorter: (a, b) => a.todayAssignments - b.todayAssignments,
  },
  {
    title: '成功',
    dataIndex: 'successCount',
    width: 70,
    sorter: (a, b) => a.successCount - b.successCount,
    render: (value: number) => (
      <Text style={{ color: '#52c41a' }}>{value}</Text>
    ),
  },
  {
    title: '失败',
    dataIndex: 'failureCount',
    width: 70,
    sorter: (a, b) => a.failureCount - b.failureCount,
    render: (value: number) => (
      value > 0 ? <Tag color="red">{value}</Tag> : value
    ),
  },
  {
    title: '成功率',
    dataIndex: 'successRate',
    width: 90,
    sorter: (a, b) => (a.successRate || 0) - (b.successRate || 0),
    render: (value: number | null) => (
      value !== null ? `${value.toFixed(1)}%` : '-'
    ),
  },
  {
    title: '最后换链时间',
    dataIndex: 'lastAssignedAt',
    width: 160,
    render: (date: Date | null) => (
      date ? dayjs(date).format('MM-DD HH:mm:ss') : '-'
    ),
  },
  {
    title: '最后监控时间',  // 新增列
    dataIndex: 'lastMonitoredAt',
    width: 160,
    sorter: (a, b) => {
      if (!a.lastMonitoredAt) return 1
      if (!b.lastMonitoredAt) return -1
      return new Date(b.lastMonitoredAt).getTime() - new Date(a.lastMonitoredAt).getTime()
    },
    defaultSortOrder: 'descend',  // 默认降序
    render: (date: Date | null) => (
      date ? dayjs(date).format('MM-DD HH:mm:ss') : '-'
    ),
  },
]}
```

**分页设置调整**：

```typescript
pagination={{
  defaultPageSize: 50,  // 修改：默认每页 50 条
  showSizeChanger: true,
  pageSizeOptions: ['10', '20', '50', '100'],
  showTotal: (total) => `共 ${total} 个广告系列`,
}}
```

## 实施计划

### 阶段 1：数据库和后端（优先）

1. 修改 Prisma Schema，添加 `todayClicks` 字段
2. 运行 `npm run db:push` 应用 Schema 变更
3. 修改 `src/lib/schemas.ts`，添加 `todayClicks` 参数
4. 修改 `src/lib/assignment-service.ts`，存储 `todayClicks`
5. 修改 `src/types/monitoring.ts`，更新类型定义
6. 重构 `src/lib/monitoring-service.ts`，实现新的查询逻辑

### 阶段 2：前端页面

1. 修改 `src/app/(dashboard)/monitoring/page.tsx`
2. 调整统计卡片（新增"总广告系列"）
3. 调整表格列定义（新增"最后监控时间"）
4. 修改默认排序和分页设置

### 阶段 3：脚本更新

1. 修改 `campaignto1.js`，获取并上报 `todayClicks`
2. 测试脚本在 Google Ads 环境中的运行

### 阶段 4：测试验证

1. 验证数据库字段正确存储
2. 验证后端 API 正确接收和处理 `todayClicks`
3. 验证前端页面正确显示所有数据
4. 验证脚本正确上报 `todayClicks`
5. 验证兼容性（旧版本脚本仍可工作）

## 风险和注意事项

### 1. 数据一致性

**风险**：脚本更新前，`todayClicks` 字段为 0，监控页面显示不准确

**缓解措施**：
- 后端先部署，脚本后更新
- 脚本更新后，数据会自动填充
- 过渡期间，前端可显示提示："今日点击数据正在同步中"

### 2. 脚本兼容性

**风险**：旧版本脚本未传递 `todayClicks`，导致数据缺失

**缓解措施**：
- `todayClicks` 设置为可选参数，默认为 0
- 后端兼容旧版本脚本
- 逐步更新所有脚本实例

### 3. 性能影响

**风险**：查询所有启用了联盟链接的 Campaign，数据量可能较大

**缓解措施**：
- 使用并行查询（`Promise.all`）
- 添加数据库索引（`campaignId`, `userId`）
- 前端分页加载，默认每页 50 条

### 4. 时区问题

**风险**：Google Ads 的"今日"与服务器时区不一致

**缓解措施**：
- Google Ads API 自动使用账户设置的时区
- 后端使用自然日（00:00 到当前时间）
- 两者应保持一致，但需在测试中验证

## 验收标准

### 功能验收

- [ ] 统计卡片显示 4 个指标：总广告系列、今日点击总数、今日换链次数、换链成功率
- [ ] 列表显示所有启用了联盟链接的 Campaign
- [ ] 列表包含 9 列：广告系列名称、Campaign ID、今日点击、换链次数、成功、失败、成功率、最后换链时间、最后监控时间
- [ ] 默认按"最后监控时间"降序排序
- [ ] 默认每页显示 50 条
- [ ] 今日无换链活动的 Campaign，成功率显示 "-"
- [ ] 从未换链的 Campaign，最后换链时间显示 "-"

### 数据准确性

- [ ] "总广告系列"数量与启用了联盟链接的 Campaign 数量一致
- [ ] "今日点击总数"与脚本上报的 `todayClicks` 之和一致
- [ ] "今日换链次数"与 `SuffixAssignment` 表今日记录数一致
- [ ] "换链成功率"计算正确（成功次数 / 换链次数）
- [ ] "最后监控时间"与 `CampaignClickState.updatedAt` 一致

### 兼容性

- [ ] 旧版本脚本（未传递 `todayClicks`）仍可正常工作
- [ ] 新版本脚本正确上报 `todayClicks`
- [ ] 数据库迁移不影响现有数据

### 性能

- [ ] 页面加载时间 < 2 秒（100 个 Campaign）
- [ ] 页面加载时间 < 5 秒（500 个 Campaign）
- [ ] 脚本执行时间不增加（`getStatsFor('TODAY')` 不增加配额消耗）

## 后续优化建议

1. **历史趋势图**：增加今日点击数和换链次数的时间趋势图
2. **告警功能**：当某个 Campaign 长时间未监控时，发送告警
3. **导出功能**：支持导出监控数据为 CSV 或 Excel
4. **实时刷新**：支持自动刷新（每 5 分钟）
5. **筛选功能**：支持按成功率、换链次数等条件筛选

## 参考资料

- [Google Ads Scripts API - Campaign.getStatsFor()](https://developers.google.com/google-ads/scripts/docs/reference/adsapp/adsapp_campaign#getStatsFor_1)
- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [Ant Design Table Component](https://ant.design/components/table)
