/**
 * 会话认证辅助函数
 *
 * 用于 API 路由中获取当前登录用户信息和数据隔离过滤
 */

import { getServerSession } from 'next-auth'
import { authOptions } from './next-auth'
import type { UserRole } from '@/types/dashboard'

export interface SessionUser {
  id: string
  role: UserRole
}

export interface SessionAuthSuccess {
  success: true
  user: SessionUser
}

export interface SessionAuthError {
  success: false
  error: {
    code: string
    message: string
    status: number
  }
}

export type SessionAuthResult = SessionAuthSuccess | SessionAuthError

/**
 * 获取当前会话用户信息
 *
 * @returns 成功时返回用户信息，失败时返回错误信息
 */
export async function getSessionUser(): Promise<SessionAuthResult> {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: '请先登录',
        status: 401,
      },
    }
  }

  return {
    success: true,
    user: {
      id: session.user.id,
      role: session.user.role,
    },
  }
}

/**
 * 根据用户角色获取 userId 过滤条件
 *
 * - 管理员：返回 undefined（不过滤，可查看所有数据）
 * - 普通用户：返回用户 ID（只能查看自己的数据）
 *
 * @param user 当前会话用户
 * @returns userId 过滤值，undefined 表示不过滤
 */
export function getUserIdFilter(user: SessionUser): string | undefined {
  return user.role === 'ADMIN' ? undefined : user.id
}
