# KyAds SuffixPool

[![CI](https://github.com/YOUR_USERNAME/kylink/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/ci.yml)
[![Test Coverage](https://github.com/YOUR_USERNAME/kylink/actions/workflows/test-coverage.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/test-coverage.yml)
[![Code Quality](https://github.com/YOUR_USERNAME/kylink/actions/workflows/code-quality.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/code-quality.yml)
[![codecov](https://codecov.io/gh/YOUR_USERNAME/kylink/branch/main/graph/badge.svg)](https://codecov.io/gh/YOUR_USERNAME/kylink)

> **Google Ads Scripts 自动写入 Final URL Suffix 系统**

## 📋 项目概述

KyAds SuffixPool 是一个自动化系统，用于：
- Google Ads Scripts 周期性上报各 Campaign 的「今日累计 clicks」
- 后端判定是否需要换链（`delta = nowClicks - lastAppliedClicks > 0`）
- 若需换链则返回 1 条新的 `finalUrlSuffix`（幂等、可重试）
- 脚本写入 `Campaign.final_url_suffix` 后必须 ack 回执

**核心特性**：
- ✅ 幂等发放：同一窗口内多次请求返回同一租约
- ✅ 可恢复：网络抖动/脚本重跑不会重复消耗库存
- ✅ 抗延迟：允许 clicks 暂时回落，使用单调递增保护
- ✅ 多租户：API Key 绑定用户，数据完全隔离
- ✅ 库存池：suffix 预生产、低水位自动补货

---

## 🛠 技术栈

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| **框架** | Next.js (App Router) | 前后端一体化 |
| **数据库** | MySQL | 关系型数据库 |
| **ORM** | Prisma | 类型安全的数据库访问 |
| **脚本端** | Google Ads Scripts | 读取 clicks、写入 suffix |

### 设计原则

- ❌ **不使用外键**：通过应用层保证数据一致性
- ✅ **启用软删除**：所有表使用 `deletedAt` 字段标记删除
- ✅ **多租户隔离**：所有查询自动带 `userId` 条件

---

## 📁 项目结构

```
kyads-suffix-pool/
├── README.md                 # 项目说明文档（本文件）
├── prd.md                    # 产品需求文档（PRD）
├── 需求0108.md               # 原始需求文档
├── schema.sql                # 数据库 SQL（待调整为 MySQL）
├── prisma/
│   └── schema.prisma         # Prisma 数据模型（待调整）
├── campaign_sync_to_sheet.js # Google Ads Scripts 同步脚本
├── tj_optimized.js           # 优化版脚本
└── src/                      # Next.js 源码目录（待创建）
    ├── app/                  # App Router 页面
    │   ├── api/              # API 路由
    │   │   └── v1/
    │   │       ├── suffix/
    │   │       │   ├── lease/
    │   │       │   └── ack/
    │   │       ├── campaigns/
    │   │       │   └── sync/
    │   │       └── sheet/
    │   │           └── import/
    │   └── page.tsx
    ├── lib/                  # 公共库
    │   ├── prisma.ts         # Prisma 客户端
    │   ├── auth.ts           # API Key 鉴权
    │   └── utils.ts          # 工具函数
    └── types/                # TypeScript 类型定义
```

---

## 🗄 数据库设计

### 数据模型概览

| 表名 | 说明 | 主要字段 |
|------|------|----------|
| `User` | 用户表 | apiKeyHash, spreadsheetId |
| `CampaignMeta` | Campaign 元数据（唯一数据源） | campaignId, country, finalUrl |
| `AffiliateLink` | 联盟链接 | url, enabled, priority |
| `SuffixStockItem` | Suffix 库存项 | finalUrlSuffix, status, exitIp |
| `SuffixLease` | Suffix 租约 | idempotencyKey, status |
| `CampaignClickState` | 点击状态（一致性状态源） | lastAppliedClicks |
| `ProxyExitIpUsage` | 代理 IP 使用记录（去重） | exitIp, expiresAt |
| `AuditLog` | 审计日志 | action, metadata |

### 软删除字段

所有表统一添加：
```prisma
deletedAt DateTime? // 软删除时间，null 表示未删除
```

### Suffix 状态流转

```
available → leased → consumed
              ↓
           failed/expired → available（回收）
```

---

## 🔌 API 接口

### 核心接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/suffix/lease` | 请求换链决策 + 领取 suffix |
| POST | `/v1/suffix/lease/batch` | 批量请求（≤100 条） |
| POST | `/v1/suffix/ack` | 回执写入结果 |
| POST | `/v1/suffix/ack/batch` | 批量回执 |
| POST | `/v1/campaigns/sync` | Campaign 元数据同步 |
| POST | `/v1/campaigns/import` | 从 Spreadsheet 导入 Campaign |

### 鉴权方式

```
Header: Authorization: Bearer ky_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API Key 格式：
- `ky_live_` + 32 位随机字符（生产环境）
- `ky_test_` + 32 位随机字符（测试环境）

### 主要响应码

| 响应 | 说明 |
|------|------|
| `action: "APPLY"` | 需要换链，返回 suffix |
| `action: "NOOP"` | 无需换链（delta ≤ 0） |
| `code: "NO_STOCK"` | 库存不足 |
| `code: "PENDING_IMPORT"` | Campaign 未导入 |
| `code: "LEASE_EXPIRED"` | 租约已过期，需重新 lease |

---

## 📊 业务规则

### 换链规则

| 编号 | 规则 |
|------|------|
| BR-001 | 仅 `nowClicks - lastAppliedClicks > 0` 才换链 |
| BR-002 | 一次触发只换 1 次（不按 delta 次数消耗） |
| BR-003 | 仅处理 CID=active 且 Campaign=enabled |
| BR-005 | 同 campaign 同窗口幂等（idempotencyKey） |
| BR-006 | 同 campaign 同时仅允许 1 个未 ack 租约 |

### 库存配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `produceBatchSize` | 10 | 单次生产数量 |
| `lowWatermark` | 3 | 低水位补货阈值 |
| `leaseTtlMinutes` | 15 | 租约超时回收时间 |
| `suffixTtlHours` | 48 | suffix 过期时间 |

---

## ✅ 开发进度

### 已完成

- [x] 需求分析与 PRD 撰写
- [x] 数据库 Schema 设计
- [x] Prisma Schema v2.0（MySQL + 无外键 + 软删除）
- [x] Google Ads Scripts 脚本（campaign_sync_to_sheet.js）
- [x] 环境变量模板（.env.example）
- [x] **Next.js 14 项目初始化**
- [x] **Ant Design 5.x 集成**
- [x] **Prisma 5.x 配置完成**
- [x] **MySQL 数据库连接配置（含影子库）**
- [x] **运行端口配置为 51001**
- [x] **API Key 鉴权中间件**
- [x] **`/v1/suffix/lease` 接口**
- [x] **`/v1/suffix/ack` 接口**
- [x] **`/v1/campaigns/sync` 接口**
- [x] **`/v1/suffix/lease/batch` 批量换链接口**
- [x] **`/v1/suffix/ack/batch` 批量回执接口**
- [x] **库存补货后台任务**
  - 低水位自动检测（阈值 3）
  - 批量补货（每次 10 条）
  - 异步触发（lease 后自动检查）
  - 定时任务端点 `/v1/jobs/replenish`
- [x] **Cron 定时任务调度器**
  - 支持内部调度和外部 Cron 触发
  - 任务执行状态跟踪
  - `/v1/jobs` 任务管理端点
- [x] **监控告警系统**
  - 低库存告警
  - 租约超时告警
  - 失败率过高告警
  - `/v1/jobs/alerts` 告警管理端点
- [x] **租约超时回收**
  - 自动回收超时（15分钟）未 ack 的租约
  - 库存自动恢复为可用
  - `/v1/jobs/recovery` 回收管理端点
- [x] **Suffix 生成器框架**
  - 代理服务接口预留
  - 联盟链接追踪框架
  - 支持模拟数据（开发）和真实代理（生产）
- [x] **前端管理界面（基础版）**
  - Dashboard/库存/租约/告警/任务/设置
  - API Key 本地保存与校验
  - 统一空态与错误提示
- [x] **链接管理模块**
  - 广告系列列表展示
  - 联盟链接增删改查
  - 支持搜索与筛选
- [x] **刷新广告系列功能**
  - 从 Google Spreadsheet 导入数据
  - 支持多个表格 URL
  - 增量更新（upsert）

### 待完成

#### P0 - 必须修复
- [x] ~~修复 Prisma findUnique 查询语法错误~~（已修复 2026-01-20）

#### P1 - 重要优化
- [ ] **整合代理验证逻辑到 Suffix 生成**
  - 复用 `redirect/tracker.ts` 的能力到 `suffix-generator.ts`
  - 实现真正的代理访问 → 追踪 → 生成 suffix 流程
- [ ] **告警持久化到数据库**
  - 当前告警存储在内存中，重启会丢失

#### P2 - 功能完善
- [ ] 完善 Google Ads Scripts 与 API 的对接测试
- [ ] 补充核心 API 单元测试

---

## 🚀 快速开始

### 1. 环境准备

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 MySQL 连接信息
```

### 2. 环境变量

```env
# 主数据库连接
DATABASE_URL="mysql://kysql04:kydir147@localhost:3306/kysql04"

# 影子数据库连接（用于 Prisma Migrate）
SHADOW_DATABASE_URL="mysql://kysql04:kydir147@localhost:3306/kysql04_shadow"

# API 配置
NEXT_PUBLIC_API_BASE_URL="http://localhost:51001"

# 代理服务配置（可选，未配置时使用模拟数据）
PROXY_API_URL="https://proxy.example.com"
PROXY_API_KEY="your_proxy_api_key"
```

### 3. 数据库初始化

```bash
# 生成 Prisma 客户端
npx prisma generate

# 推送数据库结构
npx prisma db push
```

### 4. 启动开发服务器

```bash
npm run dev
```

服务将运行在 **http://localhost:51001**

---

## 🧭 前端管理台使用说明

1. 打开 `http://localhost:51001`
2. 进入「设置」页，填写 API Key（由管理员在「用户管理」页生成）
3. 需要时填写 Spreadsheet URL（用于脚本与表格关联）
4. 进入 Dashboard/库存/租约/告警/任务/用户管理页面查看与操作

> 提示：API Key 仅保存在浏览器本地，不会上传到服务器。

---

## 🔌 代理服务对接说明（可选）

当配置 `PROXY_API_URL` 和 `PROXY_API_KEY` 后，系统会尝试调用代理服务：

### 1) 获取代理出口
`POST {PROXY_API_URL}/exit`

请求：
```json
{ "country": "US", "excludeIps": ["1.2.3.4"] }
```

响应：
```json
{ "ip": "8.8.8.8", "country": "US", "provider": "your-provider" }
```

### 2) 访问联盟链接并解析追踪参数
`POST {PROXY_API_URL}/visit`

请求：
```json
{ "url": "https://affiliate.example.com", "proxyIp": "8.8.8.8", "followRedirects": true }
```

响应：
```json
{ "finalUrl": "https://landing.example.com", "params": { "gclid": "...", "utm_source": "google" } }
```

> 若代理服务调用失败，系统会自动回退到模拟数据，确保流程不中断。

---

## 📝 变更日志

### 2026-01-20（第十三次更新 - 全面审计）
- ✅ **修复严重 Bug：Prisma findUnique 查询语法错误**
  - `/v1/suffix/lease` 接口
  - `/v1/suffix/lease/batch` 接口
  - 问题：`findUnique` 的 where 条件不支持额外过滤字段 `deletedAt: null`
  - 修复：改用 `findFirst` 方法
- ✅ 全面代码审计，更新需求文档
- ✅ 梳理待办事项清单（P0/P1/P2 优先级）
- 📝 记录架构优点：幂等性、可恢复性、多租户隔离等

### 2026-01-18（第十二次更新）
- ✅ 新增「刷新广告系列」功能
  - 从 Google Spreadsheet 导入广告系列数据
  - 支持多个 Spreadsheet URL
  - 增量更新（upsert）：存在则更新，不存在则创建
  - 失败不中断，记录错误继续处理
- ✅ 广告系列导入 API（`POST /v1/campaigns/import`）
- ✅ Google Sheet 读取工具库（`src/lib/google-sheet-reader.ts`）
  - URL 解析：提取 spreadsheetId 和 gid
  - CSV 读取：支持公开表格
  - CSV 解析：处理引号和逗号

### 2026-01-18（第十一次更新）
- ✅ 新增链接管理模块
  - 广告系列列表展示（同步脚本后自动更新）
  - 联盟链接的增删改查
  - 支持按 Campaign ID、名称、CID 搜索
  - 支持按状态筛选
  - 统计卡片展示（广告系列总数、已配置/待配置链接数、国家分布）
- ✅ 广告系列管理 API（`/v1/admin/campaigns`）
- ✅ 联盟链接管理 API（`/v1/admin/affiliate-links`）

### 2026-01-17（第十次更新）
- ✅ 新增代理管理模块（新增/编辑/删除/测试/分配）
- ✅ 代理供应商管理 API（`/v1/admin/proxy-providers`）

### 2026-01-17（第九次更新）
- ✅ 新增用户管理模块（增删改查 + API Key 重置）
- ✅ 管理端用户 API 接口（`/v1/admin/users`）
- ✅ 设置页移除“管理员生成 API Key”入口

### 2026-01-15（第八次更新）
- ✅ 前端管理台完善（Dashboard/库存/租约/告警/任务/设置）
- ✅ 设置页新增 API Key 连接测试与复制功能
- ✅ 代理服务对接规范说明（`/exit`、`/visit`）
- ✅ 接口返回结构与参数校验增强

### 2026-01-14（第七次更新）
- ✅ 实现 Cron 定时任务调度器（`src/lib/cron-scheduler.ts`）
  - 注册 3 个默认任务：补货、回收、告警
  - 支持内部调度（开发）和外部 Cron 触发（生产）
  - `/v1/jobs` - 任务管理端点
- ✅ 实现监控告警系统（`src/lib/alerting.ts`）
  - 低库存告警（< 3 条）
  - 租约超时告警（> 10 分钟）
  - 失败率告警（> 10%）
  - NO_STOCK 频率告警
  - `/v1/jobs/alerts` - 告警管理端点
- ✅ 实现租约超时回收（`src/lib/lease-recovery.ts`）
  - 自动回收超时（15分钟）租约
  - 库存恢复为可用状态
  - `/v1/jobs/recovery` - 回收管理端点
- ✅ 实现 Suffix 生成器框架（`src/lib/suffix-generator.ts`）
  - 代理服务接口预留
  - 联盟链接追踪框架
  - 环境变量配置：`PROXY_API_URL`、`PROXY_API_KEY`

### 2026-01-20（第八次更新）
- ✅ **新增 `proxy-selector.ts` 模块**（代码复用重构）
  - 提取代理供应商选择逻辑为独立模块
  - 支持按优先级选择代理
  - 支持出口 IP 检测（多服务备用）
  - 支持 24 小时 IP 去重
  - 被 `suffix-generator.ts` 和 `affiliate-configs/verify` 共同复用
- ✅ **重写 `suffix-generator.ts`**（整合代理追踪）
  - 从数据库获取用户分配的代理供应商（ProxyProvider）
  - 复用 `redirect/tracker.ts` 的完整重定向追踪能力
  - 使用 `proxy-selector.ts` 进行代理选择
  - 支持代理失败自动切换
  - 从最终 URL 提取追踪参数构建 finalUrlSuffix
  - 无代理可用时自动降级为模拟数据
- ✅ **告警系统持久化**（Alert 表）
  - 新增 Alert 模型（Prisma Schema）
  - 告警历史持久化到数据库
  - 支持分页查询告警历史
  - 支持按用户、类型、级别过滤
  - 支持批量确认告警
  - 自动清理旧告警（30天）
- ✅ **修复 Prisma 查询问题**
  - 修复 `findUnique` 与软删除条件冲突问题
  - 改用 `findFirst` 并保持唯一约束查询
  - 影响文件：`/v1/suffix/lease` 和 `/v1/suffix/lease/batch`

### 2026-01-14（第六次更新）
- ✅ 实现库存补货后台任务（`src/lib/stock-producer.ts`）
  - 低水位检测（阈值：3 条）
  - 批量补货（每次：10 条）
  - 异步触发（lease 消耗后自动检查）
  - 定时任务端点 `/v1/jobs/replenish`
- ✅ 补货 API 功能：
  - `GET /v1/jobs/replenish` - 获取库存统计
  - `POST /v1/jobs/replenish` - 手动/定时补货
  - 支持单个 campaign 或批量补货
  - 支持 CRON_SECRET 无鉴权调用（定时任务）

### 2026-01-14（第五次更新）
- ✅ 实现批量接口：
  - `POST /v1/suffix/lease/batch` - 批量换链决策（最多 100 条/次）
  - `POST /v1/suffix/ack/batch` - 批量回执（最多 100 条/次）
- ✅ 批量接口特性：
  - 每个 campaign/租约独立处理，互不影响
  - 部分失败不影响其他记录的处理
  - 支持惰性同步（lease 时附带 meta）
  - 完整的参数验证和错误提示

### 2026-01-14（第四次更新）
- ✅ 实现 API Key 鉴权中间件（`src/lib/auth.ts`）
  - SHA256 哈希验证
  - 用户状态检查（active/suspended）
  - 软删除过滤
- ✅ 实现核心 API 接口：
  - `POST /v1/suffix/lease` - 换链决策 + 领取 suffix
  - `POST /v1/suffix/ack` - 回执写入结果
  - `POST /v1/campaigns/sync` - Campaign 元数据同步
- ✅ 添加工具函数库（`src/lib/utils.ts`）

### 2026-01-14（第三次更新）
- ✅ 初始化 Next.js 14 项目结构
- ✅ 集成 Ant Design 5.x + TailwindCSS
- ✅ 配置 Prisma 5.x
  - 添加影子数据库支持（`SHADOW_DATABASE_URL`）
  - 生成 Prisma Client
  - 推送数据库结构到 MySQL
- ✅ 配置运行端口为 51001
- ✅ 创建基础页面框架（Dashboard）
- ✅ 添加 Prisma 客户端单例（`src/lib/prisma.ts`）
- ✅ 定义全局类型（`src/types/index.ts`）

### 2026-01-14（第二次更新）
- ✅ Prisma Schema 升级至 v2.0
  - 切换数据库为 MySQL
  - 使用 `relationMode = "prisma"` 移除数据库外键
  - 为业务表添加 `deletedAt` 软删除字段
  - 调整数据类型适配 MySQL（UUID → Char(36)，Timestamptz → DateTime(3)）
- ✅ 创建 `.env.example` 环境变量模板

### 2026-01-14（初始化）
- 创建项目 README.md
- 完成 PRD v1.4
- 完成 Prisma Schema 初版

---

## ✅ 已完成的 Schema 调整（v2.0）

### Prisma Schema 变更记录

| 项目 | 调整前 | 调整后 |
|------|--------|--------|
| 数据库 | `postgresql` | `mysql` |
| 外键模式 | 数据库外键 | `relationMode = "prisma"`（应用层关联） |
| UUID 类型 | `@db.Uuid` | `@db.Char(36)` |
| 时间类型 | `@db.Timestamptz` | `@db.DateTime(3)` |
| 软删除 | 无 | 所有业务表添加 `deletedAt DateTime?` |

### 软删除策略

| 表名 | 启用软删除 | 说明 |
|------|------------|------|
| User | ✅ | 用户数据需保留 |
| CampaignMeta | ✅ | Campaign 元数据需保留 |
| AffiliateLink | ✅ | 联盟链接需保留 |
| SuffixStockItem | ✅ | 库存记录需保留 |
| SuffixLease | ✅ | 租约记录需保留 |
| Alert | ✅ | 告警记录需保留（2026-01-20 新增） |
| CampaignClickState | ❌ | 状态数据随 Campaign 生命周期管理 |
| ProxyExitIpUsage | ❌ | 过期记录直接物理删除 |
| AuditLog | ❌ | 审计日志不可变，不删除 |

---

## 📚 相关文档

- [PRD 完整版](./prd.md)
- [原始需求](./需求0108.md)
- [Prisma Schema](./prisma/schema.prisma)

---

*本文档由 AI 辅助生成，每次对话后请及时更新开发进度。*

