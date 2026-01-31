# CI/CD 快速设置指南

本指南帮助你快速配置项目的 CI/CD 流程。

## 📋 前置条件

- [x] GitHub 账号
- [x] 项目已推送到 GitHub
- [ ] Codecov 账号（可选，用于覆盖率报告）

---

## 🚀 快速开始

### 1. 初始化 Git 仓库（如果还没有）

```bash
cd C:\Users\Administrator\Desktop\kylink

# 初始化 Git
git init

# 添加所有文件
git add .

# 创建初始提交
git commit -m "Initial commit with CI/CD setup"

# 添加远程仓库（替换为你的仓库地址）
git remote add origin https://github.com/YOUR_USERNAME/kylink.git

# 推送到 GitHub
git push -u origin main
```

### 2. 更新 README 徽章

编辑 `README.md`，将以下内容中的 `YOUR_USERNAME` 替换为你的 GitHub 用户名：

```markdown
[![CI](https://github.com/YOUR_USERNAME/kylink/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/ci.yml)
[![Test Coverage](https://github.com/YOUR_USERNAME/kylink/actions/workflows/test-coverage.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/test-coverage.yml)
[![Code Quality](https://github.com/YOUR_USERNAME/kylink/actions/workflows/code-quality.yml/badge.svg)](https://github.com/YOUR_USERNAME/kylink/actions/workflows/code-quality.yml)
```

### 3. 配置 Codecov（可选）

1. 访问 [codecov.io](https://codecov.io/)
2. 使用 GitHub 账号登录
3. 添加你的仓库
4. 复制 Codecov Token
5. 在 GitHub 仓库设置中添加 Secret：
   - 名称：`CODECOV_TOKEN`
   - 值：粘贴你的 Token

### 4. 验证 CI/CD 配置

推送代码后，访问：
```
https://github.com/YOUR_USERNAME/kylink/actions
```

你应该看到以下工作流自动运行：
- ✅ CI
- ✅ Test Coverage
- ✅ Code Quality

---

## 📝 本地测试

在推送代码前，建议先在本地运行 CI 检查：

```bash
# 运行完整的 CI 检查
npm run ci

# 或者运行带覆盖率的 CI 检查
npm run ci:coverage
```

---

## 🔧 工作流配置

### CI 工作流

**文件：** `.github/workflows/ci.yml`

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支

**执行内容：**
1. Lint 检查
2. 单元测试
3. 覆盖率生成
4. 项目构建
5. 类型检查

### 测试覆盖率工作流

**文件：** `.github/workflows/test-coverage.yml`

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支
- 每天定时运行

**执行内容：**
1. 运行测试
2. 生成覆盖率报告
3. 检查覆盖率阈值（50%）
4. 上传覆盖率报告

### 代码质量工作流

**文件：** `.github/workflows/code-quality.yml`

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支

**执行内容：**
1. ESLint 检查
2. 安全审计
3. 依赖审查

### PR 检查工作流

**文件：** `.github/workflows/pr-checks.yml`

**触发条件：**
- Pull Request 打开、同步或重新打开

**执行内容：**
1. PR 信息摘要
2. PR 大小检查
3. 测试文件检查

---

## 🎯 分支策略

### 推荐的分支模型

```
main (生产环境)
  ↑
develop (开发环境)
  ↑
feature/* (功能分支)
```

### 工作流程

1. **开发新功能**
   ```bash
   git checkout -b feature/your-feature develop
   # 开发...
   git add .
   git commit -m "feat: your feature"
   git push origin feature/your-feature
   ```

2. **创建 Pull Request**
   - 从 `feature/your-feature` 到 `develop`
   - CI 自动运行检查
   - 代码审查
   - 合并到 `develop`

3. **发布到生产**
   ```bash
   git checkout main
   git merge develop
   git tag v1.0.0
   git push origin main --tags
   ```

---

## 📊 查看测试报告

### 在 GitHub Actions 中查看

1. 访问 Actions 页面
2. 选择工作流运行
3. 查看详细日志和测试结果

### 在本地查看覆盖率报告

```bash
# 生成覆盖率报告
npm run test:coverage

# 在浏览器中打开报告
# Windows
start coverage/index.html

# macOS
open coverage/index.html

# Linux
xdg-open coverage/index.html
```

---

## 🐛 常见问题

### Q: CI 工作流失败了怎么办？

**A:** 检查失败的步骤：
1. 查看 Actions 日志
2. 在本地运行相同的命令
3. 修复问题后重新推送

### Q: 测试覆盖率不达标怎么办？

**A:**
1. 运行 `npm run test:coverage`
2. 查看未覆盖的代码
3. 添加测试用例
4. 重新运行测试

### Q: 如何跳过 CI 检查？

**A:** 在提交信息中添加 `[skip ci]`：
```bash
git commit -m "docs: update README [skip ci]"
```

**注意：** 不建议跳过 CI 检查，除非是纯文档更新。

### Q: 如何在 PR 中查看覆盖率变化？

**A:**
1. 确保配置了 Codecov
2. PR 中会自动显示覆盖率评论
3. 点击 Codecov 徽章查看详细报告

---

## 📚 相关资源

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Vitest 文档](https://vitest.dev/)
- [Codecov 文档](https://docs.codecov.com/)
- [项目 CI/CD 详细文档](./.github/CI_CD.md)

---

## ✅ 检查清单

设置完成后，确认以下项目：

- [ ] Git 仓库已初始化
- [ ] 代码已推送到 GitHub
- [ ] README 徽章已更新
- [ ] CI 工作流运行成功
- [ ] 测试覆盖率工作流运行成功
- [ ] 代码质量工作流运行成功
- [ ] Codecov 已配置（可选）
- [ ] 本地可以运行 `npm run ci`

---

**设置完成！** 🎉

现在每次推送代码时，CI/CD 流程都会自动运行。
