# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

KyAds SuffixPool 是一个自动化系统，用于为 Google Ads Campaign 生成并写入 Final URL Suffix。系统强调幂等性、可恢复性和多租户隔离。

**核心流程：**
1. Google Ads Scripts 周期性上报各 Campaign 的点击数
2. 后端判定是否需要换链（`delta = nowClicks - lastAppliedClicks > 0`）
3. 若需换链则返回新的 `finalUrlSuffix`（幂等、可重试）
4. 脚本写入 suffix 后发送 ack 回执

## 常用命令

```bash
npm run dev          # 开发服务器，端口 51001
npm run build        # 生产构建
npm run lint         # ESLint 检查
npm run db:generate  # 生成 Prisma 客户端
npm run db:push      # 推送 schema 到数据库
npm run db:studio    # 打开 Prisma Studio

# 创建管理员用户
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/create-admin.ts

# ⚠️ 注意：项目当前没有测试套件
# 建议添加：npm run test（单元测试）、npm run test:e2e（集成测试）
```

## 架构

### 技术栈
- Next.js 14 (App Router) - 前后端一体化
- MySQL + Prisma (relationMode: "prisma" - 无数据库外键)
- NextAuth.js - 管理后台登录认证
- API Key - 外部集成认证
- Ant Design - UI 组件库

### 目录结构
```
src/
├── app/
│   ├── api/v1/           # REST API 路由
│   │   ├── suffix/       # 核心：lease, ack, batch 接口
│   │   ├── admin/        # 用户、Campaign、代理管理
│   │   ├── campaigns/    # 同步和导入
│   │   └── jobs/         # 后台任务
│   ├── (dashboard)/      # 受保护的管理页面
│   └── login/            # 登录页
├── lib/                  # 业务逻辑
│   ├── auth.ts           # API Key 验证
│   ├── lease-service.ts  # 核心租约逻辑
│   ├── stock-producer.ts # 库存管理
│   ├── suffix-generator.ts
│   └── next-auth.ts      # Session 配置
└── types/                # TypeScript 类型定义
```

### 认证方式
- **管理后台**：NextAuth 邮箱密码登录，JWT Session（30天有效期）
- **API 接口**：Bearer Token `Authorization: Bearer ky_live_xxx` 或 `ky_test_xxx`
- API Key 格式：SHA256 哈希存储，40字符（8位前缀 + 32位随机）

### 数据库规范
- 软删除：所有表使用 `deletedAt` 字段，查询必须过滤 `deletedAt: null`
- 多租户：所有用户相关查询必须带 `userId` 条件
- UUID 存储为 `@db.Char(36)`（MySQL 兼容）

## 关键业务规则（必须遵守）

1. **换链条件**：仅当 `nowClicks - lastAppliedClicks > 0` 时换链
2. **幂等性**：同一 Campaign + 时间窗口返回同一租约（`idempotencyKey`）
3. **单租约**：同一 Campaign 同时仅允许 1 个未 ack 的租约
4. **库存状态流转**：`available → leased → consumed`（或 `failed/expired → available` 回收）
5. **点击状态**：`lastAppliedClicks` 单调递增（更新时使用 `GREATEST()`）
6. **动态库存水位**：库存低水位基于过去 24 小时消费速率动态计算
   - 公式：`ceil(avgPerHour * SAFETY_FACTOR)`，其中 `SAFETY_FACTOR = 2`
   - 范围：`MIN_WATERMARK = 3` 到 `MAX_WATERMARK = 20`
   - 新 campaign 默认水位：`DEFAULT_WATERMARK = 5`
   - 配置位置：`src/lib/utils.ts:104-115` (`DYNAMIC_WATERMARK_CONFIG`)
   - 统计来源：从 `SuffixLease` 表的 `consumedAt` 字段统计过去 24 小时的消费速率

## 主要 API 接口

| 接口 | 用途 |
|------|------|
| `POST /v1/suffix/lease` | 请求换链 + 获取 suffix |
| `POST /v1/suffix/ack` | 确认 suffix 已写入 |
| `POST /v1/suffix/lease/batch` | 批量租约（默认 ≤500 条，可通过 `MAX_BATCH_SIZE` 环境变量配置） |
| `POST /v1/suffix/ack/batch` | 批量回执（默认 ≤500 条，可通过 `MAX_BATCH_SIZE` 环境变量配置） |
| `POST /v1/campaigns/sync` | 同步 Campaign 元数据 |
| `POST /v1/campaigns/import` | 从 Google Sheets 导入 |

## 响应格式

```typescript
// 成功
{ success: true, data: {...}, action: "APPLY"|"NOOP", leaseId: "...", finalUrlSuffix: "..." }

// 错误
{ success: false, error: { code: "ERROR_CODE", message: "..." } }
```

## 环境变量

```
DATABASE_URL              # MySQL 连接字符串
SHADOW_DATABASE_URL       # Prisma 迁移用影子数据库
NEXTAUTH_SECRET           # Session 加密密钥
NEXTAUTH_URL              # 认证回调 URL
NEXT_PUBLIC_API_BASE_URL  # 前端 API 地址（默认 http://localhost:51001）
PROXY_API_URL             # 可选：代理服务地址
PROXY_API_KEY             # 可选：代理服务密钥
CRON_SECRET               # 定时任务触发密钥
ALLOW_MOCK_SUFFIX         # 是否允许模拟数据（开发：true，生产：false）
MAX_BATCH_SIZE            # 批量接口最大条数（默认 500）
STOCK_CONCURRENCY         # 单个 Campaign 并发生成数（默认 5）
CAMPAIGN_CONCURRENCY      # 批量补货时 Campaign 并发数（默认 3）
```

## 关键模式

### 错误处理
使用 `/lib/errors.ts` 中的 `AppError` 类：
- `AuthenticationError` (401)、`AuthorizationError` (403)
- `NotFoundError` (404)、`ValidationError` (422)
- `BusinessError` (400)、`InternalError` (500)

### 参数验证
使用 `/lib/schemas.ts` 中的 Zod schema 进行请求验证。

### 限流
中间件按接口限流（默认 100次/分钟，认证接口 20次/分钟）。

### 异步库存补货
租约发放后，使用 `setImmediate()` 非阻塞触发补货（`src/lib/stock-producer.ts`）。库存水位基于过去 24 小时消费速率动态计算：
- 新 campaign（无历史）：默认水位 5
- 低消费：最低水位 3
- 正常消费：`ceil(avgPerHour * 2)`
- 高消费：最高水位 20
- 并发控制：
  - `STOCK_CONCURRENCY`：单个 Campaign 内并发生成数（默认 5，可通过环境变量配置）
  - `CAMPAIGN_CONCURRENCY`：批量补货时 Campaign 并发数（默认 3，可通过环境变量配置）

### Suffix 生成与代理降级
Suffix 生成逻辑位于 `src/lib/suffix-generator.ts`：
1. 从数据库获取用户分配的代理供应商（`ProxyProvider` 表）
2. 按优先级选择代理，支持 24 小时 IP 去重（`ProxyExitIpUsage` 表）
3. 通过代理访问联盟链接，追踪重定向链路（复用 `src/lib/redirect/tracker.ts`）
4. 从最终 URL 提取追踪参数构建 `finalUrlSuffix`
5. **降级策略**（通过 `ALLOW_MOCK_SUFFIX` 环境变量控制）：
   - **生产环境**（`ALLOW_MOCK_SUFFIX=false`）：无可用代理时返回 `NO_PROXY_AVAILABLE` 错误，不生成模拟数据
   - **开发环境**（`ALLOW_MOCK_SUFFIX=true`）：无可用代理时生成模拟数据（`gclid=mock_...`）
   - ⚠️ **重要**：生产环境必须设置 `ALLOW_MOCK_SUFFIX=false`，否则会返回无效的追踪参数

2026-02-02：补充 Debian 13.3 无 Docker 部署的逐步教程。
2026-02-02：明确无 Docker 部署克隆目录为 /root/kylink。
2026-02-02：将 Prisma binaryTargets 调整为 linux-openssl-3.0.x 适配 Debian。
2026-02-03：一次性补齐 API 路由隐式 any 的类型标注并通过类型检查。
2026-02-03：修复 campaigns/sync 与 import 接口的 TypeScript 类型推断问题。
2026-02-03：补齐 campaigns/sync 现有映射的显式类型注解。
2026-02-03：移除 alerting.ts 对 Prisma 命名空间依赖以通过构建。
2026-02-03：改为本地 AlertType/AlertLevel 字面量类型避免 Prisma 类型导入。
2026-02-03：补齐 alerting.ts 中 catch 回调的显式类型标注。
2026-02-03：为告警转换函数补充本地 PrismaAlert 记录类型。
2026-02-03：修复 alerting.ts 中 Prisma JSON 类型兼容性问题以通过构建。
2026-02-03：移除 Prisma 命名空间导入以兼容服务器环境。
2026-02-03：修复 groupBy _count 类型在不同环境下的兼容性问题。
2026-02-03：为 getAlertStats 中的 groupBy 统计添加显式类型注解。
2026-02-03：全盘修复所有文件中 groupBy _count 的类型兼容性问题。
2026-02-03：添加 postinstall 脚本自动生成 Prisma 客户端。
2026-02-03：修正 Prisma binaryTargets 为 debian-openssl-3.0.x。
2026-02-03：添加 linux-musl binaryTargets 支持 Docker Alpine 环境。
2026-02-03：重写 DEPLOYMENT.md 为无 Docker 小白部署流程，适配 xc.kyads.net，并补齐 Nginx+systemd+HTTPS 运维排障说明。
2026-02-03：补充 systemd 启动失败时 EADDRINUSE(51001) 端口占用的定位与处理步骤。
2026-02-03：修正文档中环境变量文件权限与 create-admin 脚本执行方式，避免 sudo 运行时丢失 DATABASE_URL。
2026-02-03：修复 campaigns/import 接口多租户隔离问题，添加会话认证确保数据导入到当前登录用户名下。
2026-02-03：修复普通用户无法访问库存管理页面的权限问题，将 /api/v1/jobs/replenish 和 /api/v1/jobs/alerts 开放给 USER 角色。
2026-02-03：补充开放 /api/v1/jobs/recovery 给 USER 角色，修复首页和租约回收页面的权限问题。
2026-02-03：为库存管理页面的"补货所有低水位"按钮添加 SSE 实时进度反馈，显示补货状态和详细日志。
