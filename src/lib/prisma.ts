/**
 * Prisma 客户端单例
 * 
 * 在开发环境中避免因热重载导致创建多个 Prisma 实例
 * 生产环境中正常创建单个实例
 */

import { PrismaClient } from '@prisma/client'

// 声明全局类型，避免 TypeScript 报错
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// 创建 Prisma 客户端实例
// 添加软删除中间件的基础配置
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
})

// 开发环境下缓存实例
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma

