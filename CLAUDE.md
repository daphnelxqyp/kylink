# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

KyAds SuffixPool 是一个自动化系统，用于为 Google Ads Campaign 生成并写入 Final URL Suffix。系统强调幂等性、可恢复性和多租户隔离。

**核心流程：**
1. Google Ads Scripts 周期性上报各 Campaign 的点击数
2. 后端判定是否需要换链（`delta = nowClicks - lastAppliedClicks > 0`）
3. 若需换链则返回新的 `finalUrlSuffix` 和 `assignmentId`（幂等、可重试）
4. 脚本写入 suffix 后调用 report 接口回传结果

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

## Windows/PowerShell 注意事项

本项目开发环境为 Windows + PowerShell，执行命令时需注意：

1. **不支持 `&&` 链式命令**：需分开执行或使用 `;`
   ```powershell
   # ❌ 错误
   git add . && git commit -m "msg"
   
   # ✅ 正确（分开执行）
   git add .
   git commit -m "msg"
   ```

2. **不支持 Bash heredoc 语法**：多行提交信息需使用单行或 `-m` 多次
   ```powershell
   # ❌ 错误
   git commit -m "$(cat <<'EOF'
   多行内容
   EOF
   )"
   
   # ✅ 正确（单行）
   git commit -m "简短的提交信息"
   
   # ✅ 正确（多个 -m）
   git commit -m "标题" -m "详细描述"
   ```

3. **路径分隔符**：使用正斜杠 `/` 或转义反斜杠 `\\`

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
│   │   ├── suffix/       # 核心：lease, report, batch 接口
│   │   ├── admin/        # 用户、Campaign、代理管理
│   │   ├── campaigns/    # 同步和导入
│   │   └── jobs/         # 后台任务
│   ├── (dashboard)/      # 受保护的管理页面
│   └── login/            # 登录页
├── lib/                  # 业务逻辑
│   ├── auth.ts           # API Key 验证
│   ├── lease-service.ts  # 核心分配逻辑
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
2. **幂等性**：同一 Campaign + 点击数返回同一分配（`idempotencyKey = campaignId:clicks`）
3. **库存状态流转**：`available → consumed`（简化后跳过 leased 中间态）
4. **点击状态**：`lastAppliedClicks` 在分配时自动更新（单调递增）
5. **动态库存水位**：库存低水位基于过去 24 小时消费速率动态计算
   - 公式：`ceil(avgPerHour * SAFETY_FACTOR)`，其中 `SAFETY_FACTOR = 2`
   - 范围：`MIN_WATERMARK = 3` 到 `MAX_WATERMARK = 20`
   - 新 campaign 默认水位：`DEFAULT_WATERMARK = 5`
   - 配置位置：`src/lib/utils.ts:104-115` (`DYNAMIC_WATERMARK_CONFIG`)
   - 统计来源：从 `SuffixAssignment` 表的 `createdAt` 字段统计过去 24 小时的消费速率

## 主要 API 接口

| 接口 | 用途 |
|------|------|
| `POST /v1/suffix/lease` | 请求换链 + 获取 suffix |
| `POST /v1/suffix/report` | 回传写入结果 |
| `POST /v1/suffix/lease/batch` | 批量分配（默认 ≤500 条，可通过 `MAX_BATCH_SIZE` 环境变量配置） |
| `POST /v1/suffix/report/batch` | 批量回传（默认 ≤500 条，可通过 `MAX_BATCH_SIZE` 环境变量配置） |
| `POST /v1/suffix/ack` | **已废弃**（保留兼容） |
| `POST /v1/suffix/ack/batch` | **已废弃**（保留兼容） |
| `POST /v1/campaigns/sync` | 同步 Campaign 元数据 |
| `POST /v1/campaigns/import` | 从 Google Sheets 导入 |

## 响应格式

```typescript
// 成功
{ success: true, data: {...}, action: "APPLY"|"NOOP", assignmentId: "...", finalUrlSuffix: "..." }

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
ENABLE_AUTO_CRON          # 是否启用内置调度器（推荐 false，使用系统 crontab）
```

## 定时任务配置

推荐使用系统 crontab 而非内置调度器。需要配置两个任务：

| 任务 | 说明 | 频率 |
|------|------|------|
| `stock_replenish` | 补充低水位库存 | 每 10 分钟 |
| `monitoring_alert` | 系统监控告警 | 每 10 分钟 |

```bash
# 快速安装（需 root 权限）
sudo ./scripts/setup-crontab.sh

# 或手动配置
crontab -e
# 添加：
*/10 * * * * curl -fsS -X POST http://127.0.0.1:51001/api/v1/jobs -H "X-Cron-Secret: xxx" -H "Content-Type: application/json" -d '{"jobName":"stock_replenish"}' >> /var/log/kylink-cron.log 2>&1
*/10 * * * * sleep 30 && curl -fsS -X POST http://127.0.0.1:51001/api/v1/jobs -H "X-Cron-Secret: xxx" -H "Content-Type: application/json" -d '{"jobName":"monitoring_alert"}' >> /var/log/kylink-cron.log 2>&1
```

详见 `.github/DEPLOYMENT.md` 中的"定时任务配置"章节。

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
分配发放后，使用 `setImmediate()` 非阻塞触发补货（`src/lib/stock-producer.ts`）。库存水位基于过去 24 小时消费速率动态计算：
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
2026-02-03：批量补货仅针对当前用户并在进度日志中展示失败原因。
2026-02-03：为补货生成增加有限重试并输出具体失败原因以降低失败率。
2026-02-03：标记健康检查与管理端 campaigns 接口为动态并在未配置数据库时返回健康失败。
2026-02-03：修复补货结果过滤的类型谓词以通过构建检查。
2026-02-03：增强 Google Ads 脚本日志输出，区分"无点击增长"与"有增长但无联盟链接"，修复换链条件逻辑。
2026-02-03：重写 affiliate-links/lookup 接口，改为通过 campaignId 查询 AffiliateLink 表，使 Sheet 导入的 trackingUrl 可被脚本查询。
2026-02-04：修复跨天 delta 为负的问题，当检测到跨天时自动重置 lastAppliedClicks。
2026-02-04：改进刷新广告系列功能，同步库存和联盟链接：只保留 Sheet 中存在的 campaigns 的数据。
2026-02-04：库存管理页面增加广告系列名称列，便于识别 Campaign。
2026-02-04：库存管理刷新按钮只显示有启用联盟链接的广告系列，与链接管理列表保持一致。
2026-02-04：库存管理单个补货按钮也使用 SSE 流式接口实时显示补货进度。
2026-02-04：修复国家代码转换：支持逗号分隔的国家全名，多国家时只取第一个。
2026-02-04：编辑联盟链接弹窗支持手动修改国家代码。
2026-02-04：移除租约机制，改为分配-回传模式。
2026-02-04：新增 SuffixAssignment 和 SuffixWriteLog 表，职责分离。
2026-02-04：新增 /v1/suffix/report 接口用于回传写入结果。
2026-02-04：废弃 /v1/suffix/ack 接口，保留用于向后兼容。
2026-02-04：简化库存状态流转：available → consumed（跳过 leased 中间态）。
2026-02-04：新增换链监控模块，独立页面展示今日换链统计（点击数、换链次数、成功率等）。
2026-02-04：禁用内置定时调度器，改用系统 crontab；移除 lease_recovery 任务（已废弃）。
2026-02-04：修复 Google Ads 脚本未调用 report 接口的问题，添加 callReportBatchApi 函数并在写入后回传结果。
2026-02-04：审查并修复脚本：DRY_RUN 模式不回传 report、循环中断前回传已收集数据、DEBUG 日志受开关控制。
2026-02-05：修复代理用户名模板 {COUNTRY} 替换为小写的 bug，导致代理认证失败；IP 检测超时从 3 秒增加到 8 秒。
2026-02-05：增加代理降级模式：当 IP 检测失败时，先测试代理连接可用性，通过后跳过 IP 去重继续使用。
2026-02-05：增强代理测试功能：新增"完整测试"按钮测试 SOCKS5 认证和 IP 检测，失败时显示详细诊断建议；添加诊断脚本 scripts/diagnose-proxy.sh。
2026-02-05：链接验证功能增加代理警告：当所有代理失败并降级为直连时，显示黄色警告提示"代理不可用，补货功能将无法正常工作"。
2026-02-05：修复批量换链接口并发冲突问题：添加 MySQL 乐观锁冲突（错误码 1020）的自动重试机制，最多重试 3 次。
2026-02-05：完成 campaignto1.js 脚本的全面审查并给出风险与改进建议。
2026-02-05：修复脚本跨天点击重置、批量请求与回传重试逻辑。
2026-02-05：完成项目全面审查，发现 18 个问题（5 严重、4 重要、6 中等、3 轻微）。
2026-02-05：生成审查报告（AUDIT-REPORT.md）和修复方案（AUDIT-FIX-SUMMARY.md）。
2026-02-05：修复国家代码标准化问题，添加 normalizeCountryCode 函数支持 200+ 国家。
2026-02-05：识别租约机制未完全清理问题，提供自动清理脚本。
2026-02-05：修复脚本循环中断时 report 数据丢失问题，添加全局 pendingReports 机制。
2026-02-05：为脚本添加 API 调用重试机制，支持网络错误和 5xx 错误自动重试。
2026-02-05：分析系统日志确认补货流程有运行并指出并发冲突重试仍需关注。
2026-02-05：继续分析并发冲突日志并给出排查方向与原因定位。
2026-02-05：建议在服务器上安装 ripgrep 或改用 grep 继续定位重试耗尽日志。
2026-02-05：进一步基于日志定位并发来源假设与后续验证方向。
2026-02-05：交叉审查 campaignto1.js 并整理风险点与改进建议。
2026-02-05：完成 campaignto1.js 脚本全面交叉审查，发现 18 个问题（3 严重、7 重要、5 中等、3 轻微），生成详细审查报告（SCRIPT-CROSS-AUDIT.md）。
2026-02-05：修复脚本 4 个 P0 问题：删除未使用配置、修复时区回退逻辑、优化配置注释、修复国家代码分隔符。
2026-02-05：修复脚本 5 个 P1 问题：完善错误统计、提高时间检查粒度、优化表格排序、添加账户切换验证、增强 API 响应验证。
2026-02-05：修复脚本 5 个 P2 问题：网络列表配置化、多 URL 日志、魔法数字提取、调试日志采样、统一错误处理。
2026-02-05：修复后端跨天重置 lastAppliedClicks 逻辑缺失问题，同步修复 assignment-service.ts 和 lease-service.ts。
2026-02-05：优化脚本调试日志，只输出有变化的点击数；添加 NOOP 异常警告（脚本检测增长但后端 NOOP）。
2026-02-05：简化换链逻辑，移除后端 delta 判断，信任脚本增长检测，幂等键保证不重复分配。
2026-02-05：清理脚本：删除废弃的 callAckBatchApi 和测试函数，统一日志为中文，修复变量命名不一致。
2026-02-05：API 返回可用库存数量，脚本日志显示剩余库存并汇总低库存告警。
2026-02-05：修复 assignment-service.ts 中残留的 todayClicks 字段导致构建失败。
2026-02-06：修复脚本三个问题：Report 回传每轮立即发送不再积压、Sleep 前检查剩余时间避免无效等待和超时、空账户跳过多余 GAQL 查询节省扫描时间。
2026-02-06：精简脚本日志输出：移除冗余行（Lease API返回/本轮汇总/重复增长详情），后缀完整输出不再截断，APPLY结果合并显示广告系列名+点击变化+库存+完整写入后缀。
2026-02-06：继续优化脚本日志：循环头移到 sleep 后输出（时间更准确），无增长循环压缩为 1 行，删除"等待 30 秒..."冗余输出。
2026-02-06：P0 清理：删除 12 个废弃文件（租约模块 + 换链监控 + ACK 路由），移除 SuffixLease Schema，重构 alerting.ts 改用 SuffixWriteLog，API Key 移入 Script Properties。
2026-02-06：修复脚本日志中间丢失问题：连续无增长循环压缩为单行摘要（如"循环 #2~#9 无增长 ×8"），释放 Logger 缓冲区空间确保所有写入事件完整输出。
2026-02-06：将脚本 126 处 Logger.log 全部替换为 console.log，日志缓冲区从 ~10-20KB 提升到 100KB（Google Ads Scripts 官方推荐）。
