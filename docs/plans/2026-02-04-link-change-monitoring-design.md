# 换链监控模块设计文档

**日期**：2026-02-04
**版本**：1.0
**状态**：已确认

## 概述

为 KyAds SuffixPool 系统添加换链监控模块，提供独立页面展示每个广告系列的今日换链情况，包括点击数、换链次数、成功/失败统计等关键指标。

## 需求总结

### 功能定位
- 独立的监控页面，在侧边栏添加"换链监控"菜单项
- 展示当前用户所有广告系列的今日换链统计
- 支持手动刷新，无自动刷新
- 基于新架构（SuffixAssignment + SuffixWriteLog）

### 时间范围
- **今日**定义：自然日，从今天 00:00 到当前时间
- 每次查询都重新计算今日起始时间，确保跨天准确

### 数据来源
- `SuffixAssignment` 表：换链分配记录
- `SuffixWriteLog` 表：写入结果（成功/失败）
- `CampaignClickState` 表：点击状态
- `CampaignMeta` 表：广告系列名称

## 数据模型

### 核心表结构

**SuffixAssignment**（分配记录）
```prisma
model SuffixAssignment {
  id                      String   @id
  userId                  String
  campaignId              String
  suffixStockItemId       String
  finalUrlSuffix          String
  nowClicksAtAssignTime   Int
  idempotencyKey          String
  windowStartEpochSeconds BigInt
  assignedAt              DateTime @default(now())
  deletedAt               DateTime?
}
```

**SuffixWriteLog**（写入日志）
```prisma
model SuffixWriteLog {
  id                  String   @id
  assignmentId        String   @unique
  userId              String
  campaignId          String
  writeSuccess        Boolean
  writeErrorMessage   String?
  reportedAt          DateTime @default(now())
  deletedAt           DateTime?
}
```

**CampaignClickState**（点击状态）
```prisma
model CampaignClickState {
  userId             String
  campaignId         String
  lastAppliedClicks  Int       @default(0)
  lastObservedClicks Int?
  lastObservedAt     DateTime?
  updatedAt          DateTime  @updatedAt
}
```

### 统计指标定义

#### 按 Campaign 统计
1. **今日点击数**：`CampaignClickState.lastObservedClicks`
2. **今日换链次数**：`COUNT(SuffixAssignment WHERE assignedAt >= todayStart)`
3. **成功次数**：`COUNT(SuffixWriteLog WHERE writeSuccess = true AND reportedAt >= todayStart)`
4. **失败次数**：`COUNT(SuffixWriteLog WHERE writeSuccess = false AND reportedAt >= todayStart)`
5. **成功率**：`成功次数 / 换链次数 * 100%`（如果换链次数为 0，显示 0%）
6. **最后换链时间**：`MAX(SuffixAssignment.assignedAt)`

#### 全局汇总
1. **今日总点击数**：所有 Campaign 的点击数之和
2. **今日总换链次数**：所有 Campaign 的换链次数之和
3. **今日总成功次数**：所有 Campaign 的成功次数之和
4. **今日成功率**：`总成功次数 / 总换链次数 * 100%`

## API 接口设计

### 路由信息

**路径**：`GET /api/v1/monitoring/link-changes`

**认证**：
- 使用 NextAuth Session（管理后台）
- 支持 USER 和 ADMIN 角色
- 自动过滤当前用户数据（多租户隔离）

### 请求参数

无需参数，自动使用当前登录用户的 userId。

### 响应格式

```typescript
interface LinkChangeMonitoringResponse {
  success: true
  data: {
    summary: {
      totalClicks: number          // 今日总点击数
      totalAssignments: number     // 今日总换链次数
      totalSuccess: number         // 今日总成功次数
      successRate: number          // 今日成功率（百分比，保留1位小数）
    }
    campaigns: Array<{
      campaignId: string
      campaignName: string | null
      todayClicks: number          // 今日点击数
      todayAssignments: number     // 今日换链次数
      successCount: number         // 成功次数
      failureCount: number         // 失败次数
      successRate: number          // 成功率（百分比，保留1位小数）
      lastAssignedAt: Date | null  // 最后换链时间
    }>
  }
}
```

### 错误响应

```typescript
{
  success: false,
  error: {
    code: "UNAUTHORIZED" | "INTERNAL_ERROR",
    message: string
  }
}
```

## 实现架构

### 文件结构

```
src/
├── app/
│   ├── api/v1/monitoring/
│   │   └── link-changes/
│   │       └── route.ts              # API 路由
│   └── (dashboard)/
│       └── monitoring/
│           └── page.tsx              # 前端页面
├── lib/
│   └── monitoring-service.ts         # 业务逻辑（新建）
└── types/
    └── monitoring.ts                 # 类型定义（新建）
```

### 核心查询逻辑

**业务逻辑层**（`src/lib/monitoring-service.ts`）：

```typescript
export async function getLinkChangeMonitoring(userId: string) {
  // 1. 计算今日时间范围
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // 2. 查询今日分配记录（按 Campaign 分组）
  const assignments = await prisma.suffixAssignment.groupBy({
    by: ['campaignId'],
    where: {
      userId,
      assignedAt: { gte: todayStart },
      deletedAt: null
    },
    _count: { id: true },
    _max: { assignedAt: true }
  })

  // 3. 查询今日写入日志（按 Campaign 和结果分组）
  const writeLogs = await prisma.suffixWriteLog.groupBy({
    by: ['campaignId', 'writeSuccess'],
    where: {
      userId,
      reportedAt: { gte: todayStart },
      deletedAt: null
    },
    _count: { id: true }
  })

  // 4. 查询点击状态
  const clickStates = await prisma.campaignClickState.findMany({
    where: { userId }
  })

  // 5. 查询 Campaign 元数据（获取名称）
  const campaignIds = [...new Set(assignments.map(a => a.campaignId))]
  const campaigns = await prisma.campaignMeta.findMany({
    where: {
      userId,
      campaignId: { in: campaignIds },
      deletedAt: null
    },
    select: {
      campaignId: true,
      campaignName: true
    }
  })

  // 6. 数据聚合和计算
  // ... 详细实现见代码
}
```

### 查询优化

1. **数据库索引**：
   - `SuffixAssignment`: `(userId, campaignId, assignedAt)`
   - `SuffixWriteLog`: `(userId, campaignId, writeSuccess, reportedAt)`
   - 这些索引已在 schema 中定义

2. **批量查询**：
   - 使用 `groupBy` 在数据库层面聚合
   - 避免 N+1 查询问题
   - 单次请求完成所有数据获取

3. **内存计算**：
   - 在应用层进行最终的数据组装和成功率计算
   - 使用 Map 结构快速查找和关联

## 前端页面设计

### 页面路由

**路径**：`/monitoring`
**文件**：`src/app/(dashboard)/monitoring/page.tsx`

### 菜单配置

在侧边栏添加菜单项：
- **标题**：换链监控
- **图标**：`<LineChartOutlined />` 或 `<MonitorOutlined />`
- **位置**：库存管理和告警中心之间
- **权限**：USER 和 ADMIN 角色均可访问

### 页面布局

采用与库存管理页面一致的布局风格：

```
┌─────────────────────────────────────────────┐
│ 换链监控                    [刷新按钮]      │
│ 查看今日换链统计                            │
└─────────────────────────────────────────────┘

┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│今日总点击│ │今日总换链│ │今日总成功│ │今日成功率│
│  1,234   │ │   56     │ │   52     │ │  92.9%   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

┌─────────────────────────────────────────────┐
│ 表格：Campaign 明细列表                     │
│ - 广告系列名称                              │
│ - Campaign ID                               │
│ - 今日点击                                  │
│ - 换链次数                                  │
│ - 成功 / 失败                               │
│ - 成功率                                    │
│ - 最后换链时间                              │
└─────────────────────────────────────────────┘
```

### 表格列配置

| 列名 | 字段 | 宽度 | 排序 | 渲染 |
|------|------|------|------|------|
| 广告系列名称 | campaignName | 280px | - | 超长省略，显示 tooltip |
| Campaign ID | campaignId | 130px | - | - |
| 今日点击 | todayClicks | 90px | ✓ | - |
| 换链次数 | todayAssignments | 90px | ✓ | - |
| 成功 | successCount | 70px | ✓ | 绿色文本 |
| 失败 | failureCount | 70px | ✓ | >0 时显示红色 Tag |
| 成功率 | successRate | 90px | ✓ | 百分比格式（1位小数） |
| 最后换链时间 | lastAssignedAt | 160px | - | HH:mm:ss 格式 |

### 状态管理

```typescript
const [loading, setLoading] = useState(false)
const [data, setData] = useState<LinkChangeMonitoringResponse['data'] | null>(null)

const loadData = async () => {
  setLoading(true)
  try {
    const result = await getJson<LinkChangeMonitoringResponse>('/api/v1/monitoring/link-changes')
    setData(result.data)
  } catch (error) {
    message.error('加载失败')
  } finally {
    setLoading(false)
  }
}

useEffect(() => {
  loadData()
}, [])
```

### UI 组件

- **统计卡片**：使用 Ant Design `<Statistic>` 组件
- **表格**：使用 Ant Design `<Table>` 组件，支持排序
- **刷新按钮**：使用 `<Button>` + `<SyncOutlined>` 图标
- **空状态**：表格 `locale.emptyText = "暂无换链记录"`

## 边界情况处理

### 1. 无数据情况
- **场景**：新用户或今日无换链记录
- **处理**：
  - 统计卡片显示 0
  - 表格显示空状态提示
  - 成功率显示 0%

### 2. 未回传的分配
- **场景**：已分配但脚本未回传结果
- **处理**：
  - 换链次数 > (成功次数 + 失败次数)
  - 成功率按已回传的记录计算
  - 不影响统计准确性

### 3. Campaign 已删除
- **场景**：Campaign 在 CampaignMeta 中被软删除
- **处理**：
  - 仍显示历史换链数据
  - campaignName 显示为 null，前端渲染为 Campaign ID

### 4. 跨天查询
- **场景**：用户在 23:59 打开页面，0:00 后刷新
- **处理**：
  - 每次查询都重新计算 `todayStart`
  - 确保始终统计当天数据

### 5. 点击数为空
- **场景**：Campaign 从未上报过点击数
- **处理**：
  - `todayClicks` 显示为 0
  - 不影响换链统计

## 性能优化

### 数据库层面
1. **索引优化**：
   - 已有索引：`(userId, campaignId, assignedAt)`
   - 已有索引：`(userId, campaignId, writeSuccess)`
   - 查询效率：O(log n)

2. **聚合查询**：
   - 使用 `groupBy` 减少数据传输
   - 避免应用层循环查询

3. **查询范围限制**：
   - 只查询今日数据（`assignedAt >= todayStart`）
   - 自动过滤软删除记录（`deletedAt: null`）

### 应用层面
1. **单次请求**：
   - 所有数据在一次 API 调用中返回
   - 避免多次往返

2. **内存计算**：
   - 使用 Map 结构快速查找
   - 时间复杂度 O(n)

3. **前端优化**：
   - 表格支持虚拟滚动（如果数据量大）
   - 手动刷新，避免频繁请求

## 实现步骤

### 阶段 1：后端实现
1. 创建类型定义文件 `src/types/monitoring.ts`
2. 实现业务逻辑 `src/lib/monitoring-service.ts`
3. 创建 API 路由 `src/app/api/v1/monitoring/link-changes/route.ts`
4. 测试 API 接口（使用 Postman 或 curl）

### 阶段 2：前端实现
1. 创建页面文件 `src/app/(dashboard)/monitoring/page.tsx`
2. 实现数据加载和状态管理
3. 实现统计卡片和表格渲染
4. 添加刷新按钮和加载状态

### 阶段 3：集成和测试
1. 在侧边栏添加菜单项
2. 测试多租户隔离
3. 测试边界情况（无数据、跨天等）
4. 验证性能（大量数据场景）

### 阶段 4：文档和部署
1. 更新 CLAUDE.md 添加功能说明
2. 提交代码并创建 PR
3. 部署到测试环境验证
4. 部署到生产环境

## 测试场景

### 功能测试
- [ ] 正常显示今日换链统计
- [ ] 统计卡片数据正确
- [ ] 表格数据正确
- [ ] 成功率计算正确
- [ ] 排序功能正常
- [ ] 刷新按钮正常工作

### 边界测试
- [ ] 无数据时显示正常
- [ ] 跨天后数据重置
- [ ] Campaign 已删除仍显示数据
- [ ] 未回传的分配不影响统计

### 权限测试
- [ ] 未登录用户无法访问
- [ ] USER 角色只能看到自己的数据
- [ ] ADMIN 角色只能看到自己的数据

### 性能测试
- [ ] 100+ Campaign 时加载速度 < 2s
- [ ] 1000+ 换链记录时查询正常

## 技术债务和未来优化

### 当前限制
1. **无历史数据**：只显示今日数据，无法查看历史趋势
2. **无筛选功能**：无法按条件筛选 Campaign
3. **无导出功能**：无法导出数据到 Excel

### 未来优化方向
1. **历史趋势**：添加日期选择器，支持查看任意日期
2. **图表展示**：添加换链趋势图、成功率趋势图
3. **实时更新**：添加可选的自动刷新功能
4. **告警集成**：失败率过高时自动创建告警
5. **数据归档**：定期归档历史数据到汇总表，提升查询性能

## 相关文档

- [项目概述](../../CLAUDE.md)
- [数据库 Schema](../../prisma/schema.prisma)
- [API 接口规范](../../README.md)

---

**设计确认**：✅ 已通过用户确认
**实现状态**：待实现
