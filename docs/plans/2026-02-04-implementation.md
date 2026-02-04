# 移除租约机制实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标**: 简化 Suffix 分配流程，移除租约概念，改为直接分配 + 回传模式

**架构**: 创建 SuffixAssignment 和 SuffixWriteLog 两个新表，职责分离。分配时立即消费库存，回传仅记录日志。

**技术栈**: Next.js 14, Prisma, MySQL, TypeScript

**参考**: `docs/plans/2026-02-04-remove-lease-mechanism-design.md`

---

## 任务列表

1. 数据库 Schema 更新
2. 创建 assignment-service 核心服务
3. 创建 report 接口
4. 更新 lease 接口
5. 废弃 ack 接口
6. 更新文档
7. 验证构建

---

## Task 1: 数据库 Schema

**文件**: `prisma/schema.prisma`

**Step 1**: 添加 SuffixAssignment 表（在 SuffixLease 之后）

**Step 2**: 添加 SuffixWriteLog 表

**Step 3**: 更新 User 模型添加 `suffixAssignments` 关联

**Step 4**: 更新 SuffixStockItem 模型添加 `assignments` 关联

**Step 5**: 运行 `npm run db:generate && npm run db:push`

**Step 6**: 提交 `git commit -m "feat: add SuffixAssignment and SuffixWriteLog tables"`

---

## Task 2: assignment-service

**文件**: `src/lib/assignment-service.ts`（新建）

**Step 1**: 创建类型定义（CampaignAssignmentRequest, CampaignAssignmentResult, SingleReportRequest, SingleReportResult）

**Step 2**: 实现 `processSingleAssignment()` - 参考 lease-service.ts 的 processSingleLease

**Step 3**: 实现 `processSingleReport()` - 创建 SuffixWriteLog 记录

**Step 4**: 实现批量函数 `processBatchAssignment()` 和 `processBatchReport()`

**Step 5**: 运行 `npm run build` 验证

**Step 6**: 提交 `git commit -m "feat: add assignment-service"`

---

## Task 3: report 接口

**文件**:
- `src/app/api/v1/suffix/report/route.ts`（新建）
- `src/app/api/v1/suffix/report/batch/route.ts`（新建）

**Step 1**: 创建单个 report 接口（鉴权 + 验证 + 调用 processSingleReport）

**Step 2**: 创建批量 report 接口（鉴权 + 验证 + 调用 processBatchReport）

**Step 3**: 运行 `npm run build` 验证

**Step 4**: 提交 `git commit -m "feat: add report endpoints"`

---

## Task 4: 更新 lease 接口

**文件**:
- `src/app/api/v1/suffix/lease/route.ts`
- `src/app/api/v1/suffix/lease/batch/route.ts`

**Step 1**: 更新 import 为 `processSingleAssignment`

**Step 2**: 更新函数调用

**Step 3**: 响应中添加 `assignmentId` 字段

**Step 4**: 批量接口同样更新

**Step 5**: 运行 `npm run build` 验证

**Step 6**: 提交 `git commit -m "refactor: update lease to use assignment-service"`

---

## Task 5: 废弃 ack 接口

**文件**:
- `src/app/api/v1/suffix/ack/route.ts`
- `src/app/api/v1/suffix/ack/batch/route.ts`

**Step 1**: 添加 @deprecated 注释

**Step 2**: 简化为直接返回成功（保留鉴权）

**Step 3**: 运行 `npm run build` 验证

**Step 4**: 提交 `git commit -m "deprecate: mark ack endpoints as deprecated"`

---

## Task 6: 更新文档

**文件**: `CLAUDE.md`

**Step 1**: 更新核心流程说明

**Step 2**: 更新 API 接口表格

**Step 3**: 添加变更日志

**Step 4**: 提交 `git commit -m "docs: update CLAUDE.md"`

---

## Task 7: 最终验证

**Step 1**: `npm run build` - 完整构建

**Step 2**: `npx tsc --noEmit` - 类型检查

**Step 3**: `npm run lint` - 代码检查

**Step 4**: `git log --oneline -10` - 查看提交

**Step 5**: 最终提交 `git commit --allow-empty -m "chore: complete implementation"`

---

## 完成后

使用 `superpowers:finishing-a-development-branch` 决定如何合并代码。

脚本端需要修改：
1. 保存 lease 响应中的 `assignmentId`
2. 写入后调用 `/v1/suffix/report` 回传结果
3. 移除 `/v1/suffix/ack` 调用
