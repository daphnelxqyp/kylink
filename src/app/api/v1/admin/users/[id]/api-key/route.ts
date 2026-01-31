/**
 * 管理端用户 API Key 重置
 *
 * POST /v1/admin/users/:id/api-key
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { generateApiKey, hashApiKey } from '@/lib/auth'
import { parseSpreadsheetIds } from '@/lib/spreadsheet-ids'
import { errorResponse, parseJsonBody, successResponse } from '@/lib/utils'

interface AdminResetKeyRequest {
  isTest?: boolean
}

function mapAdminUser(user: {
  id: string
  email: string | null
  name: string | null
  status: string
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

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const userId = context.params.id
  const { data, error: parseError } = await parseJsonBody<AdminResetKeyRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  try {
    const existing = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    })

    if (!existing) {
      return errorResponse('NOT_FOUND', '用户不存在', 404)
    }

    const apiKey = generateApiKey(Boolean(data?.isTest))
    const apiKeyHash = hashApiKey(apiKey)
    const apiKeyPrefix = apiKey.substring(0, 12)

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        apiKeyHash,
        apiKeyPrefix,
        apiKeyCreatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        apiKeyPrefix: true,
        apiKeyCreatedAt: true,
        spreadsheetId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return successResponse({ user: mapAdminUser(updated), apiKey, mode: 'reset' })
  } catch (error) {
    console.error('Admin reset api key error:', error)
    return errorResponse('INTERNAL_ERROR', '重置 API Key 失败', 500)
  }
}

