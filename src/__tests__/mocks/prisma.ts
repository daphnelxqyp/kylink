/**
 * Prisma Client Mock
 *
 * 用于测试中 Mock Prisma 数据库操作
 */

import { vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset, DeepMockProxy } from 'vitest-mock-extended'

// 创建 Prisma Mock 实例
export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>

// 在每个测试前重置 Mock
beforeEach(() => {
  mockReset(prismaMock)
})

// Mock Prisma 模块 - 使用正确的路径
vi.mock('@/lib/prisma', async () => {
  return {
    default: prismaMock,
  }
})

export default prismaMock
