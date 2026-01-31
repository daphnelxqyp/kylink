# CI/CD 配置文档

本项目使用 GitHub Actions 实现自动化测试和部署。

## 📋 工作流概览

### 1. CI 工作流 (`ci.yml`)

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支

**执行任务：**
- ✅ 代码检出
- ✅ Node.js 环境配置（20.x）
- ✅ 依赖安装
- ✅ ESLint 检查
- ✅ 单元测试
- ✅ 测试覆盖率生成
- ✅ 覆盖率上传到 Codecov
- ✅ PR 覆盖率评论
- ✅ 项目构建
- ✅ TypeScript 类型检查

**状态徽章：**
```markdown
[![CI](https://github.com/YOUR_USERNAME/kylink/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/ci.yml)
```

---

### 2. 测试覆盖率工作流 (`test-coverage.yml`)

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支
- 每天 UTC 00:00 定时运行（北京时间 08:00）

**执行任务：**
- ✅ 运行完整测试套件
- ✅ 生成详细覆盖率报告
- ✅ 上传覆盖率报告（保留 30 天）
- ✅ 检查覆盖率阈值（50%）
- ✅ PR 覆盖率评论

**覆盖率阈值：**
- 最低要求：50%
- 目标：70%+

**状态徽章：**
```markdown
[![Test Coverage](https://github.com/YOUR_USERNAME/kylink/actions/workflows/test-coverage.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/test-coverage.yml)
```

---

### 3. 代码质量工作流 (`code-quality.yml`)

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支

**执行任务：**
- ✅ ESLint 检查（带注释）
- ✅ 安全审计（npm audit）
- ✅ 依赖审查（PR only）

**状态徽章：**
```markdown
[![Code Quality](https://github.com/YOUR_USERNAME/kylink/actions/workflows/code-quality.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/code-quality.yml)
```

---

### 4. PR 检查工作流 (`pr-checks.yml`)

**触发条件：**
- Pull Request 打开、同步或重新打开

**执行任务：**
- ✅ PR 信息摘要
- ✅ PR 大小检查
- ✅ 测试文件检查

**PR 大小分类：**
- Small: < 200 行
- Medium: 200-500 行
- Large: 500-1000 行
- Extra Large: > 1000 行

---

### 5. 发布工作流 (`release.yml`)

**触发条件：**
- 推送版本标签（`v*.*.*`）

**执行任务：**
- ✅ 运行测试
- ✅ 构建项目
- ✅ 生成变更日志
- ✅ 创建 GitHub Release

**发布流程：**
```bash
# 1. 更新版本号
npm version patch  # 或 minor, major

# 2. 推送标签
git push origin v1.0.0

# 3. GitHub Actions 自动创建 Release
```

---

## 🔧 本地测试

在提交代码前，建议在本地运行以下命令：

```bash
# 1. 运行 linter
npm run lint

# 2. 运行测试
npm run test

# 3. 生成覆盖率报告
npm run test:coverage

# 4. 类型检查
npx tsc --noEmit

# 5. 构建项目
npm run build
```

---

## 📊 测试覆盖率

### 当前覆盖率

| 文件 | 语句 | 分支 | 函数 | 行 |
|------|------|------|------|-----|
| **总体** | 53.67% | 58.91% | 50.00% | 53.86% |
| lease-service.ts | 81.13% | 88.57% | 33.33% | 81.13% |
| suffix-generator.ts | 66.07% | 57.69% | 77.77% | 65.45% |
| utils.ts | 72.72% | 76.92% | 57.14% | 72.72% |
| stock-producer.ts | 37.98% | 44.70% | 42.85% | 38.42% |

### 覆盖率目标

- ✅ 核心业务逻辑：> 70%
- ✅ 工具函数：> 70%
- ⚠️ 库存管理：> 50%（当前 37.98%）

---

## 🚀 部署流程

### 开发环境

```bash
# 1. 创建功能分支
git checkout -b feature/your-feature

# 2. 开发并提交
git add .
git commit -m "feat: your feature"

# 3. 推送到远程
git push origin feature/your-feature

# 4. 创建 Pull Request
# GitHub Actions 自动运行 CI 检查
```

### 生产环境

```bash
# 1. 合并到 main 分支
git checkout main
git merge develop

# 2. 创建版本标签
npm version patch
git push origin main --tags

# 3. GitHub Actions 自动创建 Release
```

---

## 🔐 Secrets 配置

在 GitHub 仓库设置中配置以下 Secrets：

### 必需的 Secrets

| Secret | 说明 | 示例 |
|--------|------|------|
| `CODECOV_TOKEN` | Codecov 上传令牌 | 从 codecov.io 获取 |

### 可选的 Secrets

| Secret | 说明 | 用途 |
|--------|------|------|
| `SLACK_WEBHOOK` | Slack 通知 Webhook | 测试失败通知 |
| `DISCORD_WEBHOOK` | Discord 通知 Webhook | 部署通知 |

---

## 📝 工作流状态

查看所有工作流的运行状态：

```
https://github.com/YOUR_USERNAME/kylink/actions
```

---

## 🐛 故障排查

### 测试失败

1. 检查测试日志：
   ```bash
   npm run test -- --run --reporter=verbose
   ```

2. 本地运行失败的测试：
   ```bash
   npm run test -- --run src/lib/your-test.test.ts
   ```

### 构建失败

1. 检查环境变量配置
2. 确保所有依赖已安装：
   ```bash
   npm ci
   ```

3. 清理缓存重新构建：
   ```bash
   rm -rf .next node_modules
   npm install
   npm run build
   ```

### 覆盖率不达标

1. 查看覆盖率报告：
   ```bash
   npm run test:coverage
   open coverage/index.html
   ```

2. 为未覆盖的代码添加测试

---

## 📚 相关文档

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Vitest 文档](https://vitest.dev/)
- [Codecov 文档](https://docs.codecov.com/)
- [ESLint 文档](https://eslint.org/docs/latest/)

---

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交代码（确保通过所有 CI 检查）
4. 创建 Pull Request
5. 等待代码审查

---

## 📞 联系方式

如有问题，请：
- 创建 GitHub Issue
- 联系项目维护者

---

**最后更新：** 2026-01-31
