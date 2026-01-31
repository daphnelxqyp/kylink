/**
 * 管理端用户详情
 *
 * GET    /v1/admin/users/:id - 获取用户详情
 * PUT    /v1/admin/users/:id - 更新用户信息
 * DELETE /v1/admin/users/:id - 软删除用户
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { hashPasswordBcrypt } from '@/lib/auth'
import { normalizeSpreadsheetIds, parseSpreadsheetIds, serializeSpreadsheetIds } from '@/lib/spreadsheet-ids'
import { errorResponse, parseJsonBody, successResponse } from '@/lib/utils'

interface AdminUpdateUserRequest {
  email?: string
  name?: string
  password?: string
  spreadsheetIds?: string[] | string
  spreadsheetId?: string
  status?: 'active' | 'suspended'
  role?: 'ADMIN' | 'USER'
}

function isValidEmail(email: string): boolean {
  return email.includes('@')
}

function mapAdminUser(user: {
  id: string
  email: string | null
  name: string | null
  status: string
  role: string
  apiKeyPrefix: string
  apiKeyCreatedAt: Date | null
  spreadsheetId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  const { spreadsheetId, ...rest } = user
  return {
    ...rest,
    spreadsheetIds: parseSpreadsheetIds(spreadsheetId),
  }
}

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const userId = context.params.id

  try {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        role: true,
        apiKeyPrefix: true,
        apiKeyCreatedAt: true,
        spreadsheetId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!user) {
      return errorResponse('NOT_FOUND', '用户不存在', 404)
    }

    return successResponse({ user: mapAdminUser(user) })
  } catch (error) {
    console.error('Admin user detail error:', error)
    return errorResponse('INTERNAL_ERROR', '获取用户详情失败', 500)
  }
}

export async function PUT(request: NextRequest, context: { params: { id: string } }) {
  const userId = context.params.id
  const { data, error: parseError } = await parseJsonBody<AdminUpdateUserRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  const payload = data || {}

  if (payload.email !== undefined && payload.email.trim() === '') {
    return errorResponse('VALIDATION_ERROR', 'email 不能为空', 422)
  }

  if (payload.email && !isValidEmail(payload.email.trim())) {
    return errorResponse('VALIDATION_ERROR', 'email 格式不正确', 422)
  }

  // 验证密码（如果提供了密码）
  if (payload.password !== undefined && payload.password.trim() !== '') {
    if (payload.password.length < 6) {
      return errorResponse('VALIDATION_ERROR', 'password 至少需要 6 位', 422)
    }
  }

  try {
    const existing = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return errorResponse('NOT_FOUND', '用户不存在', 404)
    }

    const normalizedEmail = payload.email ? payload.email.trim() : undefined
    const normalizedName = payload.name === undefined ? undefined : payload.name.trim() || null
    const hasSpreadsheetIds = payload.spreadsheetIds !== undefined || payload.spreadsheetId !== undefined
    const normalizedSpreadsheetIds = hasSpreadsheetIds
      ? normalizeSpreadsheetIds(payload.spreadsheetIds ?? payload.spreadsheetId)
      : undefined

    // 处理密码更新（如果提供了新密码）
    let passwordData: { passwordHash?: string; passwordSalt?: string | null } = {}
    if (payload.password && payload.password.trim() !== '') {
      passwordData = { passwordHash: hashPasswordBcrypt(payload.password.trim()), passwordSalt: null }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        email: normalizedEmail,
        name: normalizedName,
        spreadsheetId: hasSpreadsheetIds ? serializeSpreadsheetIds(normalizedSpreadsheetIds) : undefined,
        status: payload.status,
        role: payload.role,
        ...passwordData,
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        role: true,
        apiKeyPrefix: true,
        apiKeyCreatedAt: true,
        spreadsheetId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return successResponse({ user: mapAdminUser(updated) })
  } catch (error) {
    console.error('Admin update user error:', error)
    return errorResponse('INTERNAL_ERROR', '更新用户失败', 500)
  }
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  const userId = context.params.id

  try {
    const existing = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return errorResponse('NOT_FOUND', '用户不存在', 404)
    }

    const deletedAt = new Date()
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt },
    })

    return successResponse({ id: userId, deletedAt })
  } catch (error) {
    console.error('Admin delete user error:', error)
    return errorResponse('INTERNAL_ERROR', '删除用户失败', 500)
  }
}

