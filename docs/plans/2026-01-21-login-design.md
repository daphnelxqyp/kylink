# 登录功能设计文档

> **日期**：2026-01-21
> **状态**：待实现

---

## 1. 需求概述

| 项目 | 需求 |
|------|------|
| 用户规模 | 10-50 人（内部员工） |
| 认证方式 | 邮箱 + 密码 |
| 角色划分 | 管理员（ADMIN）+ 普通用户（USER） |
| 账号创建 | 管理员手动添加 |
| 安全特性 | 密码强度校验 |

---

## 2. 技术方案

**NextAuth.js + Credentials Provider**

选择理由：
- 项目已使用 Prisma，集成成本低
- Session 管理、Token 刷新开箱即用
- 安全性有保障
- 未来可扩展（如添加 Google SSO）

---

## 3. 数据模型

在现有 `User` 表基础上扩展：

```prisma
model User {
  id              String    @id @default(uuid())
  email           String    @unique
  name            String?
  passwordHash    String    // bcrypt 加密后的密码
  role            UserRole  @default(USER)
  status          UserStatus @default(ACTIVE)

  // 现有字段（保留）
  apiKeyHash      String?   @unique
  apiKeyPrefix    String?
  apiKeyCreatedAt DateTime?
  spreadsheetId   String?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // 关联
  campaigns       CampaignMeta[]
  affiliateLinks  AffiliateLink[]
  suffixStock     SuffixStockItem[]
}

enum UserRole {
  ADMIN   // 管理员：可管理用户、查看所有数据
  USER    // 普通用户：只能操作自己的数据
}

enum UserStatus {
  ACTIVE
  SUSPENDED
}
```

---

## 4. 认证架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端页面                                │
├─────────────────────────────────────────────────────────────┤
│  /login          登录页面（公开）                            │
│  /dashboard      仪表盘（需登录）                            │
│  /admin/users    用户管理（需 ADMIN 角色）                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   NextAuth.js                                │
├─────────────────────────────────────────────────────────────┤
│  /api/auth/[...nextauth]   认证 API 路由                    │
│  - signIn()                登录                              │
│  - signOut()               登出                              │
│  - getServerSession()      服务端获取会话                    │
│  - useSession()            客户端获取会话                    │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                 Credentials Provider                         │
├─────────────────────────────────────────────────────────────┤
│  1. 接收 email + password                                    │
│  2. 查询数据库验证用户                                       │
│  3. bcrypt.compare() 校验密码                                │
│  4. 返回 user 对象（含 id, email, name, role）              │
└─────────────────────────────────────────────────────────────┘
```

**Session 策略：JWT**
- 无状态，不需要服务端存储 session
- Token 包含 `userId`、`role`，方便权限判断
- 默认有效期 30 天

---

## 5. 页面与组件

### 5.1 新增页面

| 路径 | 用途 | 访问权限 |
|------|------|----------|
| `/login` | 登录页面 | 公开 |
| `/admin/users` | 用户管理 | ADMIN |

### 5.2 新增组件

```
src/components/
├── auth/
│   ├── LoginForm.tsx        # 登录表单
│   └── PasswordInput.tsx    # 密码输入框（含显示/隐藏）
├── admin/
│   ├── UserTable.tsx        # 用户列表表格
│   ├── CreateUserDialog.tsx # 创建用户弹窗
│   └── EditUserDialog.tsx   # 编辑用户弹窗
```

### 5.3 密码强度规则

- 最少 8 个字符
- 至少包含 1 个大写字母
- 至少包含 1 个小写字母
- 至少包含 1 个数字

---

## 6. API 接口

### 6.1 NextAuth 自动提供

- `POST /api/auth/callback/credentials` - 登录验证
- `POST /api/auth/signout` - 登出
- `GET /api/auth/session` - 获取当前会话

### 6.2 用户管理接口（需新增）

```
POST   /api/admin/users          创建用户
GET    /api/admin/users          获取用户列表
GET    /api/admin/users/[id]     获取单个用户
PATCH  /api/admin/users/[id]     更新用户
DELETE /api/admin/users/[id]     删除用户
```

### 6.3 接口权限控制

```typescript
const session = await getServerSession(authOptions);
if (!session || session.user.role !== 'ADMIN') {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
```

### 6.4 创建用户请求示例

```json
{
  "email": "employee@company.com",
  "name": "张三",
  "password": "初始密码",
  "role": "USER"
}
```

---

## 7. 错误处理

### 7.1 登录错误

| 场景 | 提示信息 |
|------|----------|
| 邮箱不存在 | "邮箱或密码错误" |
| 密码错误 | "邮箱或密码错误" |
| 账号已禁用 | "账号已被禁用，请联系管理员" |
| 表单校验失败 | "请输入有效的邮箱地址" |
| 服务器错误 | "登录失败，请稍后重试" |

### 7.2 管理接口错误

| 场景 | HTTP 状态码 | 响应 |
|------|-------------|------|
| 未登录 | 401 | `{ "error": "Unauthorized" }` |
| 非管理员 | 403 | `{ "error": "Forbidden" }` |
| 用户不存在 | 404 | `{ "error": "User not found" }` |
| 邮箱已存在 | 409 | `{ "error": "Email already exists" }` |

---

## 8. 实现文件清单

### 8.1 需要新增

```
src/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   └── [...nextauth]/
│   │   │       └── route.ts
│   │   └── admin/
│   │       └── users/
│   │           ├── route.ts
│   │           └── [id]/
│   │               └── route.ts
│   ├── login/
│   │   └── page.tsx
│   └── admin/
│       └── users/
│           └── page.tsx
├── components/
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   └── PasswordInput.tsx
│   └── admin/
│       ├── UserTable.tsx
│       ├── CreateUserDialog.tsx
│       └── EditUserDialog.tsx
└── lib/
    ├── auth.ts
    └── password.ts
```

### 8.2 需要修改

- `prisma/schema.prisma` - 添加 role、passwordHash 字段
- `src/middleware.ts` - 添加登录和角色校验逻辑

### 8.3 依赖安装

```bash
npm install next-auth bcryptjs
npm install -D @types/bcryptjs
```

---

## 9. 实现步骤

1. 安装依赖
2. 修改 Prisma Schema，运行迁移
3. 实现 NextAuth 配置（`/api/auth/[...nextauth]`）
4. 实现密码工具函数（`lib/password.ts`）
5. 实现登录页面和表单组件
6. 修改 middleware 添加认证保护
7. 实现用户管理 API
8. 实现用户管理页面
9. 创建初始管理员账号
