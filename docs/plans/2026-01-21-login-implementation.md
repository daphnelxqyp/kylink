# 登录功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为内部员工 SaaS 系统添加邮箱+密码登录功能，区分管理员和普通用户角色。

**Architecture:** 使用 NextAuth.js Credentials Provider 实现认证，JWT 策略存储 session。在现有 User 表基础上添加 role 字段，复用已有的 passwordHash/passwordSalt 字段。

**Tech Stack:** NextAuth.js v4, bcryptjs (替换现有 PBKDF2), Prisma, Ant Design

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装 next-auth 和 bcryptjs**

```bash
npm install next-auth@4 bcryptjs
npm install -D @types/bcryptjs
```

**Step 2: 验证安装**

```bash
npm ls next-auth bcryptjs
```

Expected: 显示 next-auth@4.x.x 和 bcryptjs@x.x.x

---

## Task 2: 修改 Prisma Schema 添加 role 字段

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: 添加 UserRole 枚举和 role 字段**

在 `enum UserStatus` 后添加：

```prisma
enum UserRole {
  ADMIN
  USER
}
```

在 User model 的 `passwordSalt` 字段后添加：

```prisma
  role            UserRole   @default(USER)
```

**Step 2: 推送 schema 变更**

```bash
npx prisma db push
```

Expected: 输出 "Your database is now in sync with your Prisma schema."

**Step 3: 生成 Prisma Client**

```bash
npx prisma generate
```

Expected: 输出 "Generated Prisma Client"

---

## Task 3: 更新密码工具函数（使用 bcryptjs）

**Files:**
- Modify: `src/lib/auth.ts`

**Step 1: 添加 bcryptjs 导入和新函数**

在文件顶部导入后添加：

```typescript
import bcrypt from 'bcryptjs'
```

在 `hashPassword` 函数后添加新函数：

```typescript
/**
 * 使用 bcrypt 哈希密码（用于新认证系统）
 */
export function hashPasswordBcrypt(password: string): string {
  return bcrypt.hashSync(password, 10)
}

/**
 * 验证 bcrypt 密码
 */
export function verifyPasswordBcrypt(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

/**
 * 验证密码（兼容旧 PBKDF2 和新 bcrypt）
 */
export function verifyPassword(password: string, hash: string, salt: string | null): boolean {
  // 如果有 salt，使用旧的 PBKDF2 方式验证
  if (salt) {
    const computedHash = pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex')
    return computedHash === hash
  }
  // 否则使用 bcrypt 验证
  return bcrypt.compareSync(password, hash)
}
```

---

## Task 4: 创建 NextAuth 配置

**Files:**
- Create: `src/lib/next-auth.ts`

**Step 1: 创建 NextAuth 配置文件**

```typescript
/**
 * NextAuth.js 配置
 *
 * 使用 Credentials Provider 实现邮箱+密码登录
 */

import { AuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import prisma from './prisma'
import { verifyPassword } from './auth'

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: '邮箱', type: 'email' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('请输入邮箱和密码')
        }

        const user = await prisma.user.findFirst({
          where: {
            email: credentials.email,
            deletedAt: null,
          },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            passwordSalt: true,
            role: true,
            status: true,
          },
        })

        if (!user || !user.passwordHash) {
          throw new Error('邮箱或密码错误')
        }

        if (user.status === 'suspended') {
          throw new Error('账号已被禁用，请联系管理员')
        }

        const isValid = verifyPassword(
          credentials.password,
          user.passwordHash,
          user.passwordSalt
        )

        if (!isValid) {
          throw new Error('邮箱或密码错误')
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 天
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
      }
      return session
    },
  },
}
```

---

## Task 5: 创建 NextAuth 类型声明

**Files:**
- Create: `src/types/next-auth.d.ts`

**Step 1: 创建类型声明文件**

```typescript
import 'next-auth'
import { UserRole } from '@prisma/client'

declare module 'next-auth' {
  interface User {
    id: string
    role: UserRole
  }

  interface Session {
    user: {
      id: string
      email: string | null
      name: string | null
      role: UserRole
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: UserRole
  }
}
```

---

## Task 6: 创建 NextAuth API 路由

**Files:**
- Create: `src/app/api/auth/[...nextauth]/route.ts`

**Step 1: 创建 API 路由文件**

```typescript
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/next-auth'

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
```

---

## Task 7: 添加 NEXTAUTH_SECRET 环境变量

**Files:**
- Modify: `.env`
- Modify: `.env.example`

**Step 1: 生成密钥并添加到 .env**

生成密钥：

```bash
openssl rand -base64 32
```

在 `.env` 文件末尾添加：

```
# NextAuth
NEXTAUTH_SECRET=<生成的密钥>
NEXTAUTH_URL=http://localhost:51001
```

**Step 2: 更新 .env.example**

在 `.env.example` 末尾添加：

```
# NextAuth
NEXTAUTH_SECRET=your-secret-key-here
NEXTAUTH_URL=http://localhost:51001
```

---

## Task 8: 创建登录页面

**Files:**
- Create: `src/app/login/page.tsx`

**Step 1: 创建登录页面**

```typescript
'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button, Card, Form, Input, Typography, Alert, Space } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'

const { Title, Text } = Typography

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const callbackUrl = searchParams.get('callbackUrl') || '/'

  const handleSubmit = async (values: { email: string; password: string }) => {
    setLoading(true)
    setError(null)

    try {
      const result = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      })

      if (result?.error) {
        setError(result.error)
      } else {
        router.push(callbackUrl)
        router.refresh()
      }
    } catch {
      setError('登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
      }}
    >
      <Card style={{ width: 400, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={3} style={{ marginBottom: 8 }}>
              KyAds SuffixPool
            </Title>
            <Text type="secondary">内部管理系统</Text>
          </div>

          {error && (
            <Alert message={error} type="error" showIcon closable onClose={() => setError(null)} />
          )}

          <Form layout="vertical" onFinish={handleSubmit} autoComplete="off">
            <Form.Item
              name="email"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '请输入有效的邮箱地址' },
              ]}
            >
              <Input
                prefix={<MailOutlined />}
                placeholder="邮箱"
                size="large"
                autoComplete="email"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码"
                size="large"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
              >
                登录
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  )
}
```

---

## Task 9: 创建 SessionProvider 包装组件

**Files:**
- Create: `src/components/providers/session-provider.tsx`

**Step 1: 创建 SessionProvider**

```typescript
'use client'

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react'
import { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

export default function SessionProvider({ children }: Props) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>
}
```

---

## Task 10: 修改根 layout 添加 SessionProvider

**Files:**
- Modify: `src/app/layout.tsx`

**Step 1: 读取现有 layout 内容**

首先查看现有 layout.tsx 的内容。

**Step 2: 添加 SessionProvider 包装**

在 layout.tsx 中：
1. 导入 SessionProvider
2. 用 SessionProvider 包裹 children

```typescript
import SessionProvider from '@/components/providers/session-provider'

// 在 return 中用 SessionProvider 包裹内容
<SessionProvider>
  {/* 现有内容 */}
</SessionProvider>
```

---

## Task 11: 修改 middleware 添加登录保护

**Files:**
- Modify: `src/middleware.ts`

**Step 1: 添加登录检查逻辑**

在 middleware 中添加：

```typescript
import { getToken } from 'next-auth/jwt'

// 在 middleware 函数开头，处理页面路由的登录保护
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 公开路由（无需登录）
  const publicPaths = ['/login', '/api/auth']
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

  // API 路由使用 API Key 认证，不需要 session 认证
  const isApiRoute = pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')

  if (!isPublicPath && !isApiRoute) {
    // 页面路由需要登录
    const token = await getToken({ req: request })

    if (!token) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // 检查 admin 路由的角色权限
    if (pathname.startsWith('/admin') && token.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  // 继续现有的 rate limiting 和安全头逻辑...
}
```

---

## Task 12: 修改 AppLayout 添加登出按钮

**Files:**
- Modify: `src/components/app-layout.tsx`

**Step 1: 添加 session 和登出功能**

```typescript
import { useSession, signOut } from 'next-auth/react'
import { LogoutOutlined } from '@ant-design/icons'

// 在组件内部添加：
const { data: session } = useSession()

// 在 Header 右侧添加用户信息和登出按钮：
<Space>
  {session?.user && (
    <>
      <Text>{session.user.email}</Text>
      {session.user.role === 'ADMIN' && <Tag color="blue">管理员</Tag>}
      <Button
        icon={<LogoutOutlined />}
        onClick={() => signOut({ callbackUrl: '/login' })}
      >
        登出
      </Button>
    </>
  )}
</Space>
```

---

## Task 13: 更新用户创建 API 使用 bcrypt

**Files:**
- Modify: `src/app/api/v1/admin/users/route.ts`

**Step 1: 更新密码哈希方式**

将 `hashPassword` 替换为 `hashPasswordBcrypt`：

```typescript
import { generateApiKey, hashApiKey, hashPasswordBcrypt, validateApiKeyFormat } from '@/lib/auth'

// 在创建用户时：
const passwordHash = hashPasswordBcrypt(password)

// 创建用户时不再需要 passwordSalt
const created = await prisma.user.create({
  data: {
    email,
    name,
    status,
    role: 'USER', // 默认为普通用户
    apiKeyHash,
    apiKeyPrefix,
    apiKeyCreatedAt: new Date(),
    passwordHash,
    // 移除 passwordSalt
    spreadsheetId: serializeSpreadsheetIds(spreadsheetIds),
  },
  // ...
})
```

---

## Task 14: 更新用户编辑 API 使用 bcrypt

**Files:**
- Modify: `src/app/api/v1/admin/users/[id]/route.ts`

**Step 1: 更新密码更新逻辑**

```typescript
import { hashPasswordBcrypt } from '@/lib/auth'

// 在更新密码时：
if (password) {
  updateData.passwordHash = hashPasswordBcrypt(password)
  updateData.passwordSalt = null // 清除旧的 salt
}
```

---

## Task 15: 添加角色管理到用户管理页面

**Files:**
- Modify: `src/app/(dashboard)/users/page.tsx`

**Step 1: 添加角色列和编辑**

在 columns 中添加角色列：

```typescript
{
  title: '角色',
  dataIndex: 'role',
  render: (value: string) =>
    value === 'ADMIN' ? <Tag color="blue">管理员</Tag> : <Tag>普通用户</Tag>,
},
```

在表单中添加角色选择（仅管理员可见）：

```typescript
<Form.Item label="角色" name="role">
  <Select
    options={[
      { label: '普通用户', value: 'USER' },
      { label: '管理员', value: 'ADMIN' },
    ]}
  />
</Form.Item>
```

---

## Task 16: 更新类型定义

**Files:**
- Modify: `src/types/dashboard.ts`

**Step 1: 添加 role 字段到 AdminUserItem**

```typescript
export interface AdminUserItem {
  id: string
  email: string | null
  name: string | null
  status: UserStatus
  role: 'ADMIN' | 'USER'  // 添加这行
  apiKeyPrefix: string
  apiKeyCreatedAt: string | null
  spreadsheetIds: string[]
  createdAt: string
  updatedAt: string
}
```

---

## Task 17: 创建初始管理员脚本

**Files:**
- Create: `scripts/create-admin.ts`

**Step 1: 创建脚本**

```typescript
/**
 * 创建初始管理员账号
 *
 * 使用方法：
 * npx ts-node scripts/create-admin.ts <email> <password>
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient()

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]

  if (!email || !password) {
    console.error('Usage: npx ts-node scripts/create-admin.ts <email> <password>')
    process.exit(1)
  }

  // 检查用户是否已存在
  const existing = await prisma.user.findFirst({
    where: { email, deletedAt: null },
  })

  if (existing) {
    console.error('用户已存在:', email)
    process.exit(1)
  }

  // 生成 API Key
  const apiKey = 'ky_live_' + crypto.createHash('sha256')
    .update(Math.random().toString() + Date.now().toString())
    .digest('hex')
    .substring(0, 32)

  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex')
  const passwordHash = bcrypt.hashSync(password, 10)

  const user = await prisma.user.create({
    data: {
      email,
      name: 'Admin',
      role: 'ADMIN',
      status: 'active',
      apiKeyHash,
      apiKeyPrefix: apiKey.substring(0, 12),
      apiKeyCreatedAt: new Date(),
      passwordHash,
    },
  })

  console.log('管理员创建成功!')
  console.log('Email:', email)
  console.log('API Key:', apiKey)
  console.log('User ID:', user.id)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

---

## Task 18: 验证完整流程

**Step 1: 启动开发服务器**

```bash
npm run dev
```

**Step 2: 创建管理员账号**

```bash
npx ts-node scripts/create-admin.ts admin@company.com Admin123
```

**Step 3: 测试登录流程**

1. 访问 http://localhost:51001
2. 应自动重定向到 /login
3. 使用管理员账号登录
4. 登录成功后应重定向到首页
5. 验证可以访问所有页面
6. 测试登出功能

**Step 4: 测试普通用户**

1. 在用户管理页面创建普通用户
2. 登出后用普通用户登录
3. 验证可以正常使用系统

---

## 验收标准

- [ ] 未登录用户访问任何页面都重定向到 /login
- [ ] 登录成功后重定向到原目标页面
- [ ] 登出后返回 /login
- [ ] 管理员可以管理用户和设置角色
- [ ] 密码强度要求：至少 8 位，包含大小写字母和数字
- [ ] 错误提示友好（不泄露账号是否存在）
