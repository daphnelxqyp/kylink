'use client'

/**
 * 用户角色 Hook
 *
 * 提供当前登录用户的角色信息，用于前端组件中的权限判断
 */

import { useSession } from 'next-auth/react'
import type { UserRole } from '@/types/dashboard'

export interface UseUserRoleResult {
  /** 用户角色 */
  role: UserRole
  /** 是否为管理员 */
  isAdmin: boolean
  /** 用户 ID */
  userId: string | undefined
  /** 会话是否正在加载 */
  isLoading: boolean
}

/**
 * 获取当前用户角色信息
 *
 * @returns 用户角色相关信息
 */
export function useUserRole(): UseUserRoleResult {
  const { data: session, status } = useSession()

  const role = (session?.user?.role as UserRole) || 'USER'

  return {
    role,
    isAdmin: role === 'ADMIN',
    userId: session?.user?.id,
    isLoading: status === 'loading',
  }
}
