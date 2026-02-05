# 换链监控模块重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重构换链监控模块，新增"总广告系列"统计卡片，显示所有启用了联盟链接的 Campaign，新增"最后监控时间"列，优化排序和分页。

**Architecture:**
- 数据库层：在 `CampaignClickState` 表新增 `todayClicks` 字段存储脚本上报的今日点击数
- 后端层：修改 API schema 接收 `todayClicks`，重构监控服务查询所有启用了联盟链接的 Campaign
- 前端层：调整统计卡片和表格列定义，修改默认排序和分页

**Tech Stack:** Prisma, Next.js 14, TypeScript, Ant Design, Zod

---

## Task 1: 数据库 Schema 变更

**Files:**
- Modify: `prisma/schema.prisma` (CampaignClickState 模型)

**Step 1: 修改 Prisma Schema**

在 `prisma/schema.prisma` 中找到 `CampaignClickState` 模型，添加 `todayClicks` 字段：

```prisma
model CampaignClickState {
  id                  String   @id @default(uuid()) @db.Char(36)
  userId              String   @db.Char(36)
  campaignId          String
  lastObservedClicks  Int      @default(0)
  lastAppliedClicks   Int      @default(0)
  todayClicks         Int      @default(0)  // 新增
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([userId, campaignId])
  @@index([userId])
  @@map("campaign_click_states")
}
```

**Step 2: 应用 Schema 变更**

运行命令：
```bash
npm run db:push
```

预期输出：包含 "Applied migration" 或 "Database is already in sync"

**Step 3: 验证字段已添加**

运行命令：
```bash
npm run db:studio
```

在 Prisma Studio 中打开 `campaign_click_states` 表，确认 `todayClicks` 字段存在。

**Step 4: 提交变更**

```bash
git add prisma/schema.prisma
git commit -m "feat(db): 添加 todayClicks 字段到 CampaignClickState"
```

---

## Task 2: 更新类型定义

**Files:**
- Modify: `src/types/monitoring.ts`

**Step 1: 修改 CampaignLinkChangeStat 接口**

在 `src/types/monitoring.ts` 中修改接口：

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
  successRate: number | null       // 成功率（今日无换链时为 null）- 修改类型
  lastAssignedAt: Date | null      // 最后换链时间（历史）
  lastMonitoredAt: Date | null     // 新增：最后监控时间
}
```

**Step 2: 修改 LinkChangeSummary 接口**

```typescript
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
```

**Step 3: 提交变更**

```bash
git add src/types/monitoring.ts
git commit -m "feat(types): 更新监控类型定义，新增 totalCampaigns 和 lastMonitoredAt"
```

---

## Task 3: 更新 API Schema

**Files:**
- Modify: `src/lib/schemas.ts`

**Step 1: 找到 suffixLeaseRequestSchema**

在 `src/lib/schemas.ts` 中找到 `suffixLeaseRequestSchema` 定义。

**Step 2: 添加 todayClicks 字段**

```typescript
export const suffixLeaseRequestSchema = z.object({
  campaignId: z.string().min(1),
  nowClicks: z.number().int().min(0),
  todayClicks: z.number().int().min(0).optional(),  // 新增：可选字段
  cid: z.string().min(1),
  mccId: z.string().optional(),
})
```

**Step 3: 验证批量 schema 自动继承**

确认 `suffixLeaseBatchRequestSchema` 使用了 `suffixLeaseRequestSchema`，无需额外修改。

**Step 4: 提交变更**

```bash
git add src/lib/schemas.ts
git commit -m "feat(api): 添加 todayClicks 参数到 lease schema"
```

---

## Task 4: 更新分配服务

**Files:**
- Modify: `src/lib/assignment-service.ts`

**Step 1: 找到 assignSuffixForCampaign 函数**

在 `src/lib/assignment-service.ts` 中找到 `assignSuffixForCampaign` 函数。

**Step 2: 修改函数签名**

在函数参数中添加 `todayClicks`：

```typescript
export async function assignSuffixForCampaign(
  userId: string,
  campaignId: string,
  nowClicks: number,
  todayClicks: number = 0,  // 新增参数，默认值 0
  cid: string,
  mccId?: string
): Promise<AssignmentResult>
```

**Step 3: 更新 CampaignClickState upsert**

找到 `prisma.campaignClickState.upsert` 调用，修改为：

```typescript
await prisma.campaignClickState.upsert({
  where: { userId_campaignId: { userId, campaignId } },
  create: {
    userId,
    campaignId,
    lastObservedClicks: nowClicks,
    lastAppliedClicks: nowClicks,
    todayClicks,  // 新增
  },
  update: {
    lastObservedClicks: nowClicks,
    lastAppliedClicks: nowClicks,
    todayClicks,  // 新增
    updatedAt: new Date(),
  },
})
```

**Step 4: 更新批量分配函数**

找到 `assignSuffixBatch` 函数，修改调用 `assignSuffixForCampaign` 的地方：

```typescript
const result = await assignSuffixForCampaign(
  userId,
  req.campaignId,
  req.nowClicks,
  req.todayClicks ?? 0,  // 新增参数
  req.cid,
  req.mccId
)
```

**Step 5: 提交变更**

```bash
git add src/lib/assignment-service.ts
git commit -m "feat(service): 支持存储 todayClicks 到 CampaignClickState"
```

---

## Task 5: 重构监控服务

**Files:**
- Modify: `src/lib/monitoring-service.ts`

**Step 1: 备份当前实现**

复制当前的 `getLinkChangeMonitoring` 函数内容作为参考。

**Step 2: 重写查询逻辑 - 第一部分（查询启用的 Campaign）**

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

  // 如果没有启用的 Campaign，直接返回空数据
  if (campaignIds.length === 0) {
    return {
      summary: {
        totalCampaigns: 0,
        totalClicks: 0,
        totalAssignments: 0,
        totalSuccess: 0,
        successRate: 0,
      },
      campaigns: [],
    }
  }
```

**Step 3: 重写查询逻辑 - 第二部分（并行查询数据）**

```typescript
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
```

**Step 4: 重写查询逻辑 - 第三部分（构建辅助 Map）**

```typescript
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
```

**Step 5: 重写查询逻辑 - 第四部分（构建统计数据）**

```typescript
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

**Step 6: 提交变更**

```bash
git add src/lib/monitoring-service.ts
git commit -m "refactor(service): 重构监控服务，查询所有启用了联盟链接的 Campaign"
```

---

## Task 6: 更新前端页面 - 统计卡片

**Files:**
- Modify: `src/app/(dashboard)/monitoring/page.tsx`

**Step 1: 导入 DatabaseOutlined 图标**

在文件顶部的 import 语句中添加：

```typescript
import {
  SyncOutlined,
  LineChartOutlined,
  SwapOutlined,
  CheckCircleOutlined,
  PercentageOutlined,
  DatabaseOutlined,  // 新增
} from '@ant-design/icons'
```

**Step 2: 找到统计卡片的 Row 组件**

找到包含 4 个 Col 的 Row 组件（约在第 65-108 行）。

**Step 3: 在第一个位置插入"总广告系列"卡片**

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

**Step 4: 删除原来的"今日总成功次数"卡片**

移除显示 `totalSuccess` 的卡片（如果存在）。

**Step 5: 提交变更**

```bash
git add src/app/(dashboard)/monitoring/page.tsx
git commit -m "feat(ui): 添加总广告系列统计卡片"
```

---

## Task 7: 更新前端页面 - 表格列定义

**Files:**
- Modify: `src/app/(dashboard)/monitoring/page.tsx`

**Step 1: 找到 Table 组件的 columns 定义**

找到 `<Table<CampaignLinkChangeStat>` 组件的 `columns` 属性。

**Step 2: 修改"成功率"列的 render 函数**

```typescript
{
  title: '成功率',
  dataIndex: 'successRate',
  width: 90,
  sorter: (a, b) => (a.successRate || 0) - (b.successRate || 0),
  render: (value: number | null) => (
    value !== null ? `${value.toFixed(1)}%` : '-'
  ),
},
```

**Step 3: 修改"最后换链时间"列的格式**

```typescript
{
  title: '最后换链时间',
  dataIndex: 'lastAssignedAt',
  width: 160,
  render: (date: Date | null) => (
    date ? dayjs(date).format('MM-DD HH:mm:ss') : '-'
  ),
},
```

**Step 4: 在最后添加"最后监控时间"列**

```typescript
{
  title: '最后监控时间',
  dataIndex: 'lastMonitoredAt',
  width: 160,
  sorter: (a, b) => {
    if (!a.lastMonitoredAt) return 1
    if (!b.lastMonitoredAt) return -1
    return new Date(b.lastMonitoredAt).getTime() - new Date(a.lastMonitoredAt).getTime()
  },
  defaultSortOrder: 'descend',
  render: (date: Date | null) => (
    date ? dayjs(date).format('MM-DD HH:mm:ss') : '-'
  ),
},
```

**Step 5: 提交变更**

```bash
git add src/app/(dashboard)/monitoring/page.tsx
git commit -m "feat(ui): 添加最后监控时间列，优化成功率显示"
```

---

## Task 8: 更新前端页面 - 分页设置

**Files:**
- Modify: `src/app/(dashboard)/monitoring/page.tsx`

**Step 1: 找到 Table 组件的 pagination 属性**

找到 `<Table>` 组件的 `pagination` 配置。

**Step 2: 修改分页配置**

```typescript
pagination={{
  defaultPageSize: 50,  // 修改：默认每页 50 条
  showSizeChanger: true,
  pageSizeOptions: ['10', '20', '50', '100'],
  showTotal: (total) => `共 ${total} 个广告系列`,
}}
```

**Step 3: 修改空数据提示**

```typescript
locale={{ emptyText: '暂无数据' }}
```

**Step 4: 提交变更**

```bash
git add src/app/(dashboard)/monitoring/page.tsx
git commit -m "feat(ui): 调整分页默认每页 50 条"
```

---

## Task 9: 类型检查和构建验证

**Files:**
- None (verification only)

**Step 1: 运行类型检查**

运行命令：
```bash
npm run build
```

预期输出：构建成功，无类型错误。

**Step 2: 如果有类型错误，修复它们**

根据错误信息修复类型问题，常见问题：
- `successRate` 类型不匹配：确保前端处理 `null` 值
- `lastMonitoredAt` 类型不匹配：确保类型定义一致

**Step 3: 再次运行构建**

```bash
npm run build
```

确保构建成功。

**Step 4: 提交修复（如果有）**

```bash
git add .
git commit -m "fix: 修复类型错误"
```

---

## Task 10: 更新 Google Ads 脚本

**Files:**
- Modify: `campaignto1.js`

**Step 1: 找到获取点击数的代码**

在脚本中找到 `campaign.getStatsFor('ALL_TIME').getClicks()` 的调用位置（约在第 180-200 行）。

**Step 2: 添加获取今日点击数**

```javascript
// 当前代码
const nowClicks = campaign.getStatsFor('ALL_TIME').getClicks();

// 修改为
const nowClicks = campaign.getStatsFor('ALL_TIME').getClicks();
const todayClicks = campaign.getStatsFor('TODAY').getClicks();  // 新增
```

**Step 3: 添加到数据对象**

找到构建 `needsChangeList` 的代码，添加 `todayClicks` 字段：

```javascript
needsChangeList.push({
  campaign: campaign,
  campaignId: campaignId,
  nowClicks: nowClicks,
  todayClicks: todayClicks,  // 新增
  trackingUrl: trackingUrl,
  cid: cid,
  campaignName: campaignName
});
```

**Step 4: 找到批量请求构建代码**

找到 `batchRequests` 的构建代码（约在第 200-220 行）。

**Step 5: 添加 todayClicks 到请求**

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

**Step 6: 提交变更**

```bash
git add campaignto1.js
git commit -m "feat(script): 添加今日点击数上报"
```

---

## Task 11: 手动测试验证

**Files:**
- None (manual testing)

**Step 1: 启动开发服务器**

```bash
npm run dev
```

**Step 2: 登录管理后台**

访问 http://localhost:51001/login，使用测试账号登录。

**Step 3: 访问换链监控页面**

访问 http://localhost:51001/monitoring

**Step 4: 验证统计卡片**

确认显示 4 个卡片：
- 总广告系列
- 今日点击总数
- 今日换链次数
- 换链成功率

**Step 5: 验证列表展示**

确认列表包含以下列：
- 广告系列名称
- Campaign ID
- 今日点击
- 换链次数
- 成功
- 失败
- 成功率
- 最后换链时间
- 最后监控时间

**Step 6: 验证默认排序**

确认列表默认按"最后监控时间"降序排序。

**Step 7: 验证分页**

确认默认每页显示 50 条。

**Step 8: 验证数据显示**

- 今日无换链的 Campaign，成功率显示 "-"
- 从未换链的 Campaign，最后换链时间显示 "-"
- 从未监控的 Campaign，最后监控时间显示 "-"

**Step 9: 记录测试结果**

如果发现问题，记录并修复。

---

## Task 12: 更新 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: 在文件末尾添加更新日志**

```markdown
2026-02-05：重构换链监控模块，新增总广告系列统计卡片，显示所有启用了联盟链接的 Campaign。
2026-02-05：新增最后监控时间列，显示脚本最后一次上报点击数的时间。
2026-02-05：今日点击数改为脚本直接上报（todayClicks 字段），优化数据准确性。
2026-02-05：调整监控页面默认排序为最后监控时间降序，默认分页每页 50 条。
```

**Step 2: 提交变更**

```bash
git add CLAUDE.md
git commit -m "docs: 更新 CLAUDE.md 记录监控模块重构"
```

---

## Task 13: 最终验证和清理

**Files:**
- None (final verification)

**Step 1: 运行完整构建**

```bash
npm run build
```

确保构建成功。

**Step 2: 运行 lint 检查**

```bash
npm run lint
```

修复任何 lint 错误。

**Step 3: 查看 git 状态**

```bash
git status
```

确保所有变更已提交。

**Step 4: 查看提交历史**

```bash
git log --oneline -15
```

确认所有任务的提交都存在。

**Step 5: 推送到远程（可选）**

如果需要推送到远程分支：

```bash
git push origin feature/monitoring-refactor
```

---

## 完成标准

- [ ] 数据库 Schema 已更新，`todayClicks` 字段存在
- [ ] 类型定义已更新，包含 `totalCampaigns` 和 `lastMonitoredAt`
- [ ] API Schema 支持接收 `todayClicks` 参数
- [ ] 分配服务正确存储 `todayClicks`
- [ ] 监控服务查询所有启用了联盟链接的 Campaign
- [ ] 前端显示 4 个统计卡片，包含"总广告系列"
- [ ] 前端列表包含"最后监控时间"列
- [ ] 默认按"最后监控时间"降序排序
- [ ] 默认每页显示 50 条
- [ ] 今日无换链的 Campaign，成功率显示 "-"
- [ ] Google Ads 脚本上报 `todayClicks`
- [ ] 所有变更已提交到 git
- [ ] 构建和 lint 检查通过
- [ ] 手动测试验证通过

---

## 注意事项

1. **兼容性**：`todayClicks` 为可选参数，旧版本脚本仍可正常工作
2. **数据迁移**：现有数据的 `todayClicks` 默认为 0，不影响监控页面
3. **时区问题**：Google Ads 的"今日"使用账户设置的时区，与服务器时区应保持一致
4. **性能**：使用并行查询（`Promise.all`）优化性能
5. **测试失败**：worktree 中有 2 个测试失败，与本次重构无关，可稍后单独处理
