/**
 * NextAuth.js 配置
 *
 * 使用 Credentials Provider 实现邮箱+密码登录
 */

import { AuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import prisma from './prisma'
import { verifyPassword } from './auth'
import type { UserRole } from '@/types/dashboard'

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
        session.user.role = token.role as UserRole
      }
      return session
    },
  },
}
