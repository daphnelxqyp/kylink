/**
 * POST /v1/admin/api-keys
 *
 * 管理端生成/重置 API Key
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { generateApiKey, hashApiKey } from '@/lib/auth'
import { normalizeSpreadsheetIds, serializeSpreadsheetIds } from '@/lib/spreadsheet-ids'
import { errorResponse, parseJsonBody, successResponse, validateRequired } from '@/lib/utils'

interface AdminApiKeyRequest {
  email: string
  name?: string
  isTest?: boolean
  spreadsheetIds?: string[] | string
  spreadsheetId?: string
  reset?: boolean
}

export async function POST(request: NextRequest) {
  const { data, error: parseError } = await parseJsonBody<AdminApiKeyRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  const { valid, missing } = validateRequired(data || {}, ['email'])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  const email = data!.email.trim()
  if (!email.includes('@')) {
    return errorResponse('VALIDATION_ERROR', 'email 格式不正确', 422)
  }

  const isTest = data?.isTest !== false
  const name = data?.name?.trim() || '管理员测试用户'
  const spreadsheetIds = normalizeSpreadsheetIds(data?.spreadsheetIds ?? data?.spreadsheetId)
  const serializedSpreadsheetIds = serializeSpreadsheetIds(spreadsheetIds)
  const reset = Boolean(data?.reset)

  try {
    const existingUser = await prisma.user.findFirst({
      where: {
        email,
        deletedAt: null,
      },
    })

    const apiKey = generateApiKey(isTest)
    const apiKeyHash = hashApiKey(apiKey)
    const apiKeyPrefix = apiKey.substring(0, 12)

    if (existingUser) {
      if (!reset) {
        return errorResponse('CONFLICT', '用户已存在，如需重置请传 reset=true', 409)
      }

      const updated = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name,
          apiKeyHash,
          apiKeyPrefix,
          apiKeyCreatedAt: new Date(),
          spreadsheetId: serializedSpreadsheetIds,
          status: 'active',
          deletedAt: null,
        },
        select: {
          id: true,
          email: true,
          apiKeyPrefix: true,
        },
      })

      return successResponse({
        userId: updated.id,
        email: updated.email,
        apiKey,
        apiKeyPrefix: updated.apiKeyPrefix,
        mode: 'reset',
      })
    }

    const created = await prisma.user.create({
      data: {
        email,
        name,
        apiKeyHash,
        apiKeyPrefix,
        apiKeyCreatedAt: new Date(),
        spreadsheetId: serializedSpreadsheetIds,
        status: 'active',
      },
      select: {
        id: true,
        email: true,
        apiKeyPrefix: true,
      },
    })

    return successResponse({
      userId: created.id,
      email: created.email,
      apiKey,
      apiKeyPrefix: created.apiKeyPrefix,
      mode: 'created',
    })
  } catch (error) {
    console.error('Admin API key error:', error)
    return errorResponse('INTERNAL_ERROR', '生成 API Key 失败', 500)
  }
}

