/**
 * 管理端代理供应商单项操作
 *
 * PUT    /v1/admin/proxy-providers/:id - 更新代理供应商
 * DELETE /v1/admin/proxy-providers/:id - 删除代理供应商（软删除）
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponse, parseJsonBody, successResponse, validateRequired } from '@/lib/utils'

interface AdminUpdateProxyProviderRequest {
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

export async function PUT(request: NextRequest, context: { params: { id: string } }) {
  const { data, error: parseError } = await parseJsonBody<AdminUpdateProxyProviderRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  const { valid, missing } = validateRequired(data || {}, ['name', 'host', 'port', 'usernameTemplate'])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  const name = data!.name.trim()
  const host = data!.host.trim()
  const usernameTemplate = data!.usernameTemplate.trim()
  const port = parsePort(data!.port)

  if (!name || !host || !usernameTemplate) {
    return errorResponse('VALIDATION_ERROR', '名称、地址与用户名模板不能为空', 422)
  }

  if (!port) {
    return errorResponse('VALIDATION_ERROR', '端口号无效', 422)
  }

  const providerId = context.params.id

  try {
    const existing = await prisma.proxyProvider.findFirst({
      where: { id: providerId, deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return errorResponse('NOT_FOUND', '代理供应商不存在或已删除', 404)
    }

    const updateData: {
      name: string
      host: string
      port: number
      usernameTemplate: string
      priority: number
      enabled: boolean
      password?: string | null
    } = {
      name,
      host,
      port,
      usernameTemplate,
      priority: parsePriority(data?.priority),
      enabled: data?.enabled !== false,
    }

    const trimmedPassword = data?.password?.trim()
    if (trimmedPassword) {
      // 密码直接存储明文（不加密）
      updateData.password = trimmedPassword
    }

    const updated = await prisma.proxyProvider.update({
      where: { id: providerId },
      data: updateData,
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

    return successResponse({ provider: updated })
  } catch (error) {
    console.error('Admin update proxy provider error:', error)
    return errorResponse('INTERNAL_ERROR', '更新代理供应商失败', 500)
  }
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  const providerId = context.params.id

  try {
    const existing = await prisma.proxyProvider.findFirst({
      where: { id: providerId, deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return errorResponse('NOT_FOUND', '代理供应商不存在或已删除', 404)
    }

    await prisma.proxyProvider.update({
      where: { id: providerId },
      data: { deletedAt: new Date() },
    })

    return successResponse({ success: true })
  } catch (error) {
    console.error('Admin delete proxy provider error:', error)
    return errorResponse('INTERNAL_ERROR', '删除代理供应商失败', 500)
  }
}

