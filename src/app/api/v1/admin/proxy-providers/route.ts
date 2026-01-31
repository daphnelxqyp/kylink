/**
 * 管理端代理供应商管理
 *
 * GET  /v1/admin/proxy-providers  - 获取代理供应商列表
 * POST /v1/admin/proxy-providers  - 创建代理供应商
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponse, parseJsonBody, successResponse, validateRequired } from '@/lib/utils'

interface AdminCreateProxyProviderRequest {
  name: string
  priority?: number
  host: string
  port: number
  usernameTemplate: string
  password?: string
  enabled?: boolean
}

function parsePort(value: unknown): number | null {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }
  return port
}

function parsePriority(value: unknown): number {
  const priority = Number(value)
  return Number.isFinite(priority) ? Math.trunc(priority) : 0
}

export async function GET(_request: NextRequest) {
  try {
    const providers = await prisma.proxyProvider.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
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
        // 多用户分配数据
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
    const formattedProviders = providers.map(provider => ({
      ...provider,
      assignedUsers: provider.assignedUsers.map(au => au.user),
    }))

    return successResponse({ providers: formattedProviders, total: formattedProviders.length })
  } catch (error) {
    console.error('Admin proxy providers list error:', error)
    return errorResponse('INTERNAL_ERROR', '获取代理供应商列表失败', 500)
  }
}

export async function POST(request: NextRequest) {
  const { data, error: parseError } = await parseJsonBody<AdminCreateProxyProviderRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  const { valid, missing } = validateRequired(data || {}, [
    'name',
    'host',
    'port',
    'usernameTemplate',
    'password',
  ])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  const name = data!.name.trim()
  const host = data!.host.trim()
  const usernameTemplate = data!.usernameTemplate.trim()
  // 密码直接存储明文（不加密）
  const password = data!.password?.trim() || null
  const port = parsePort(data!.port)

  if (!name || !host || !usernameTemplate) {
    return errorResponse('VALIDATION_ERROR', '名称、地址与用户名模板不能为空', 422)
  }

  if (!port) {
    return errorResponse('VALIDATION_ERROR', '端口号无效', 422)
  }

  try {
    const created = await prisma.proxyProvider.create({
      data: {
        name,
        host,
        port,
        usernameTemplate,
        password,
        priority: parsePriority(data?.priority),
        enabled: data?.enabled !== false,
      },
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
        createdAt: true,
        updatedAt: true,
      },
    })

    return successResponse({ provider: created }, 201)
  } catch (error) {
    console.error('Admin create proxy provider error:', error)
    return errorResponse('INTERNAL_ERROR', '创建代理供应商失败', 500)
  }
}

