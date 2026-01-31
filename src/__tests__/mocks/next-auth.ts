/**
 * NextAuth Mock
 *
 * 用于测试中 Mock NextAuth 认证
 */

import { vi } from 'vitest'

// Mock NextAuth 会话
export const mockSession = {
  user: {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
}

// Mock getServerSession
export const mockGetServerSession = vi.fn()

// Mock NextAuth 模块
vi.mock('next-auth/next', () => ({
  getServerSession: mockGetServerSession,
}))

export default {
  mockSession,
  mockGetServerSession,
}
