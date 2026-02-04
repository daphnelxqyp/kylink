# 移除租约机制设计方案

**日期**: 2026-02-04
**状态**: 待实施
**目标**: 简化 Suffix 分配流程，移除租约概念，改为直接分配 + 回传模式

## 背景

当前系统使用"租用-确认"两阶段模式：
1. 脚本调用 `/v1/suffix/lease` 获取 suffix（创建租约）
2. 脚本写入 Google Ads 后调用 `/v1/suffix/ack` 确认结果

虽然已经简化为 Lease 时直接标记为 consumed，但"租约"的概念仍然存在，增加了理解和维护成本。

**用户需求**：
- 完全移除租约概念
- 脚本写入后回传结果，用于日志记录
- 写入失败的 suffix 直接丢弃，不回收

## 设计目标

1. **简化概念模型**：从"租约"改为"分配"，更直观
2. **职责分离**：分配逻辑和写入日志分离到独立的表和接口
3. **保持幂等性**：相同点击数的重复请求返回相同的 suffix
4. **完整日志**：记录所有分配和写入结果，便于审计和排查

## 整体架构

### 核心理念转变

**之前**：租用 → 确认（两阶段提交）
**现在**：分配 → 回传（分配即消费，回传仅记录日志）

### API 端点变化

| 端点 | 状态 | 说明 |
|------|------|------|
| `POST /v1/suffix/lease` | 保留 | 改为分配逻辑，保持接口名称兼容 |
| `POST /v1/suffix/lease/batch` | 保留 | 批量分配 |
| `POST /v1/suffix/report` | **新增** | 回传写入结果 |
| `POST /v1/suffix/report/batch` | **新增** | 批量回传 |
| `POST /v1/suffix/ack` | 废弃 | 保留一段时间用于兼容，返回成功但不处理 |
| `POST /v1/suffix/ack/batch` | 废弃 | 同上 |

## 数据库设计

### 新增表 1：SuffixAssignment（Suffix 分配记录）

```prisma
model SuffixAssignment {
  id                      String   @id @default(uuid()) @db.Char(36)
  userId                  String   @db.Char(36)
  campaignId              String   @db.VarChar(64)
  suffixStockItemId       String   @db.Char(36)
  finalUrlSuffix          String   @db.Text              // 存储实际分配的 suffix（用于幂等返回）
  nowClicksAtAssignTime   Int                            // 分配时的点击数
  idempotencyKey          String   @db.VarChar(128)      // campaignId:clicks
  windowStartEpochSeconds BigInt                         // 窗口开始时间戳
  assignedAt              DateTime @default(now()) @db.DateTime(3)
  deletedAt               DateTime? @db.DateTime(3)

  user            User            @relation(fields: [userId], references: [id])
  suffixStockItem SuffixStockItem @relation(fields: [suffixStockItemId], references: [id])
  writeLog        SuffixWriteLog? // 一对一关联到写入日志

  @@unique([userId, idempotencyKey])
  @@index([userId, campaignId])
  @@index([assignedAt])
  @@index([deletedAt])
}
```

**设计要点**：
- `finalUrlSuffix` 字段用于幂等返回（重复请求返回相同 suffix）
- `idempotencyKey` 唯一索引确保同一点击数不会重复分配
- 与 `SuffixWriteLog` 一对一关联

### 新增表 2：SuffixWriteLog（写入结果日志）

```prisma
model SuffixWriteLog {
  id                  String   @id @default(uuid()) @db.Char(36)
  assignmentId        String   @unique @db.Char(36)  // 关联到 SuffixAssignment
  userId              String   @db.Char(36)
  campaignId          String   @db.VarChar(64)
  writeSuccess        Boolean                        // 写入是否成功
  writeErrorMessage   String?  @db.Text              // 失败原因
  reportedAt          DateTime @default(now()) @db.DateTime(3)
  deletedAt           DateTime? @db.DateTime(3)

  assignment SuffixAssignment @relation(fields: [assignmentId], references: [id])

  @@index([userId, campaignId])
  @@index([writeSuccess])
  @@index([reportedAt])
  @@index([deletedAt])
}
```

**设计要点**：
- `assignmentId` 唯一索引确保每个分配只能回传一次
- `writeSuccess` 索引用于统计成功率
- 冗余 `userId` 和 `campaignId` 便于直接查询

### 保留的表

- `SuffixLease` 表保留用于历史数据查询
- 新流程不再使用此表
- 可在后续版本中归档或删除

## 核心业务流程

### 流程 1：Suffix 分配（POST /v1/suffix/lease）

```
1. 鉴权
   ↓
2. 幂等检查（查询 SuffixAssignment）
   ├─ 存在 → 返回已分配的 suffix
   └─ 不存在 → 继续
   ↓
3. Campaign 元数据同步（CampaignMeta）
   ↓
4. 点击状态检查（CampaignClickState）
   ↓
5. 换链判断（delta = nowClicks - lastAppliedClicks）
   ├─ delta <= 0 → 返回 NOOP
   └─ delta > 0 → 继续
   ↓
6. 库存分配（SuffixStockItem）
   ├─ 无库存 → 触发补货，返回 NO_STOCK
   └─ 有库存 → 继续
   ↓
7. 事务处理
   ├─ 创建 SuffixAssignment
   ├─ 更新 SuffixStockItem.status = 'consumed'
   └─ 更新 CampaignClickState.lastAppliedClicks
   ↓
8. 异步触发库存补货检查
   ↓
9. 返回 { action: "APPLY", assignmentId, finalUrlSuffix }
```

**关键点**：
- 分配时立即更新 `lastAppliedClicks`（不等待回传）
- 库存直接标记为 `consumed`（不可回收）
- 幂等性通过 `idempotencyKey` 保证

### 流程 2：写入结果回传（POST /v1/suffix/report）

```
1. 鉴权
   ↓
2. 验证分配记录（SuffixAssignment）
   ├─ 不存在 → 返回 404
   └─ 存在 → 继续
   ↓
3. 幂等检查（SuffixWriteLog）
   ├─ 已存在 → 返回成功（幂等）
   └─ 不存在 → 继续
   ↓
4. 创建 SuffixWriteLog 记录
   ↓
5. 返回 { success: true }
```

**关键点**：
- 回传仅用于日志记录，不影响业务状态
- 写入失败的 suffix 不回收（已在分配时标记为 consumed）
- 支持幂等重试

## API 接口规范

### 接口 1：POST /v1/suffix/lease

**请求体**：
```typescript
{
  campaignId: string
  nowClicks: number
  observedAt: string          // ISO 8601
  scriptInstanceId: string
  cycleMinutes: number
  windowStartEpochSeconds: number
  idempotencyKey: string      // 例如：campaignId:clicks
  meta?: {
    campaignName: string
    country: string
    finalUrl: string
    cid: string
    mccId: string
  }
}
```

**响应体**：
```typescript
// 成功分配
{
  success: true,
  action: "APPLY",
  assignmentId: string,       // 新增：用于回传时关联
  finalUrlSuffix: string,
  reason?: string
}

// 无需换链
{
  success: true,
  action: "NOOP",
  reason: string
}

// 错误
{
  success: false,
  code: "NO_STOCK" | "PENDING_IMPORT" | "INTERNAL_ERROR",
  message: string
}
```

**状态码**：
- 200: 成功（APPLY 或 NOOP）
- 202: Campaign 未导入（PENDING_IMPORT）
- 409: 库存不足（NO_STOCK）
- 500: 内部错误

### 接口 2：POST /v1/suffix/report（新增）

**请求体**：
```typescript
{
  assignmentId: string        // 从 lease 响应中获取
  campaignId: string          // 用于验证
  writeSuccess: boolean       // 写入是否成功
  writeErrorMessage?: string  // 失败时的错误信息
  reportedAt: string          // ISO 8601
}
```

**响应体**：
```typescript
{
  success: true,
  message?: string            // 例如："已记录"或"已记录（幂等）"
}
```

**状态码**：
- 200: 成功记录
- 404: 分配记录不存在
- 422: 参数验证失败
- 500: 内部错误

### 接口 3：POST /v1/suffix/lease/batch

**请求体**：
```typescript
{
  campaigns: Array<{
    campaignId: string
    nowClicks: number
    observedAt: string
    idempotencyKey: string
    windowStartEpochSeconds: number
    meta?: { ... }
  }>
}
```

**响应体**：
```typescript
{
  success: true,
  results: Array<{
    campaignId: string
    action: "APPLY" | "NOOP"
    assignmentId?: string
    finalUrlSuffix?: string
    reason?: string
    code?: string              // 错误码（如果失败）
    message?: string           // 错误信息
  }>
}
```

**限制**：
- 最大批量大小：500 条（通过 `MAX_BATCH_SIZE` 环境变量配置）
- 并行处理：使用 `Promise.all`

### 接口 4：POST /v1/suffix/report/batch（新增）

**请求体**：
```typescript
{
  reports: Array<{
    assignmentId: string
    campaignId: string
    writeSuccess: boolean
    writeErrorMessage?: string
    reportedAt: string
  }>
}
```

**响应体**：
```typescript
{
  success: true,
  results: Array<{
    assignmentId: string
    ok: boolean
    message?: string
  }>
}
```

**限制**：
- 最大批量大小：500 条
- 部分失败不影响其他记录

## 错误处理

### 错误场景

| 场景 | 处理方式 | 状态码 |
|------|---------|--------|
| 库存不足 | 触发异步补货，返回 NO_STOCK | 409 |
| Campaign 未导入 | 如有 meta 则自动创建，否则返回 PENDING_IMPORT | 202 |
| 重复请求（Lease） | 返回已分配的 suffix（幂等） | 200 |
| 重复请求（Report） | 返回成功，不重复创建日志 | 200 |
| 分配记录不存在（Report） | 返回错误 | 404 |
| 跨天点击数重置 | 自动重置 lastAppliedClicks = 0 | - |

### 数据一致性保证

1. **事务处理**：所有涉及多表操作使用 `prisma.$transaction`
2. **单调递增**：`lastAppliedClicks` 使用 `GREATEST()` 函数
3. **软删除**：所有查询过滤 `deletedAt: null`
4. **多租户隔离**：所有查询包含 `userId` 条件

### 日志和监控

- 所有错误记录到控制台，包含 userId、campaignId、timestamp
- 通过 `SuffixWriteLog` 统计写入成功率
- 未回传的分配可通过左连接查询发现（但不主动告警）

## 实施计划

### 阶段 1：数据库迁移

1. 创建 `SuffixAssignment` 和 `SuffixWriteLog` 表
2. 添加必要的索引
3. 运行 `npm run db:push` 应用变更

### 阶段 2：后端实现

1. **新增文件**：
   - `src/lib/assignment-service.ts`（核心业务逻辑）
   - `src/app/api/v1/suffix/report/route.ts`
   - `src/app/api/v1/suffix/report/batch/route.ts`

2. **修改文件**：
   - `src/app/api/v1/suffix/lease/route.ts`（调用新服务）
   - `src/app/api/v1/suffix/lease/batch/route.ts`
   - `prisma/schema.prisma`（添加新表）

3. **废弃文件**（保留但标记）：
   - `src/app/api/v1/suffix/ack/route.ts`（返回成功但不处理）
   - `src/app/api/v1/suffix/ack/batch/route.ts`

### 阶段 3：脚本端修改

Google Ads 脚本需要修改：
1. 调用 `/v1/suffix/lease` 后，保存 `assignmentId`
2. 写入 Google Ads Campaign 的 Final URL Suffix
3. 调用 `/v1/suffix/report` 回传结果（成功或失败）
4. 移除 `/v1/suffix/ack` 调用

### 阶段 4：测试和验证

1. 单元测试：测试 assignment-service 的各种场景
2. 集成测试：测试完整的分配-回传流程
3. 压力测试：验证批量接口性能
4. 监控验证：确认日志记录完整

### 阶段 5：上线和清理

1. 部署新版本后端
2. 更新脚本（可分批更新）
3. 监控一段时间后，移除 `/v1/suffix/ack` 接口
4. 归档或删除 `SuffixLease` 表的历史数据

## 向后兼容性

- 保留 `/v1/suffix/ack` 接口一段时间（例如 2 周）
- 接口返回成功但不做实际处理
- 响应格式保持兼容，新增 `assignmentId` 字段
- 给脚本迁移留出缓冲期

## 性能影响

- **API 调用次数**：不变（lease + report = 原来的 lease + ack）
- **数据库写入**：略有增加（两个表 vs 一个表），影响可忽略
- **查询性能**：提升（不再需要复杂的状态过滤）
- **代码复杂度**：降低（移除状态机逻辑）

## 风险和缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 脚本未及时回传 | 缺少写入日志 | 不影响业务，可通过左连接查询发现 |
| 写入失败率高 | 浪费 suffix | 监控成功率，优化脚本逻辑 |
| 数据库迁移失败 | 服务中断 | 在测试环境充分验证，准备回滚方案 |
| 脚本兼容性问题 | 旧脚本无法工作 | 保留 ack 接口缓冲期，分批更新脚本 |

## 总结

本设计方案通过移除租约概念，将系统简化为"分配-回传"模式：
- **分配时**：立即消费库存，更新点击状态，返回 suffix
- **回传时**：仅记录写入结果日志，不影响业务状态

优势：
- 概念更简单，易于理解和维护
- 职责分离清晰（分配 vs 日志）
- 保持幂等性和数据一致性
- 性能无明显影响

适用场景：
- 内部员工使用，写入失败率可控
- 不需要复杂的失败重试机制
- 重视日志完整性和可审计性
