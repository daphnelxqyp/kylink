/**
 * 管理端代理供应商分配
 *
 * POST /v1/admin/proxy-providers/:id/assign - 分配给指定用户（支持多用户）
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponse, parseJsonBody, successResponse } from '@/lib/utils'

/** Prisma 事务客户端类型 */
type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

interface AdminAssignProxyProviderRequest {
  // 支持单个用户 ID（向后兼容）或多个用户 ID 数组
  userId?: string | null
  userIds?: string[]
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const { data, error: parseError } = await parseJsonBody<AdminAssignProxyProviderRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  const providerId = context.params.id
  
  // 优先使用 userIds 数组，如果没有则使用单个 userId（向后兼容）
  let userIds: string[] = []
  if (data?.userIds && Array.isArray(data.userIds)) {
    userIds = data.userIds.map(id => id.trim()).filter(Boolean)
  } else if (data?.userId?.trim()) {
    userIds = [data.userId.trim()]
  }

  try {
    // 检查代理供应商是否存在
    const existing = await prisma.proxyProvider.findFirst({
      where: { id: providerId, deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return errorResponse('NOT_FOUND', '代理供应商不存在或已删除', 404)
    }

    // 验证所有用户是否存在
    if (userIds.length > 0) {
      const existingUsers = await prisma.user.findMany({
        where: { id: { in: userIds }, deletedAt: null },
        select: { id: true },
      })

      const existingUserIds = new Set(existingUsers.map((u: { id: string }) => u.id))
      const missingUserIds = userIds.filter(id => !existingUserIds.has(id))

      if (missingUserIds.length > 0) {
        return errorResponse('NOT_FOUND', `以下用户不存在或已删除: ${missingUserIds.join(', ')}`, 404)
      }
    }

    // 使用事务更新分配关系
    await prisma.$transaction(async (tx: TransactionClient) => {
      // 1. 删除该代理商的所有现有分配
      await tx.proxyProviderUser.deleteMany({
        where: { proxyProviderId: providerId },
      })

      // 2. 创建新的分配关系
      if (userIds.length > 0) {
        await tx.proxyProviderUser.createMany({
          data: userIds.map(userId => ({
            proxyProviderId: providerId,
            userId,
          })),
        })
      }

      // 3. 更新 assignedUserId 为第一个用户（保持向后兼容）
      await tx.proxyProvider.update({
        where: { id: providerId },
        data: { assignedUserId: userIds.length > 0 ? userIds[0] : null },
      })
    })

    // 查询更新后的完整数据
    const updated = await prisma.proxyProvider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        name: true,
        priority: true,
        host: true,
        port: true,
        usernameTemplate: true,
        enabled: true,
        assignedUserId: true,
        assignedUser: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        assignedUsers: {
          select: {
            userId: true,
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    })

    // 转换格式，将 assignedUsers 转为更简洁的结构
    const result = {
      ...updated,
      assignedUsers: updated?.assignedUsers?.map(au => au.user) || [],
    }

    return successResponse({ provider: result })
  } catch (error) {
    console.error('Admin assign proxy provider error:', error)
    return errorResponse('INTERNAL_ERROR', '分配代理供应商失败', 500)
  }
}

