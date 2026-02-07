/**
 * PUT /v1/users/me/password
 *
 * 当前登录用户自助修改密码（基于 Session 认证）
 *
 * 请求体：
 *   { oldPassword: string, newPassword: string }
 *
 * 安全措施：
 *   - 必须验证旧密码
 *   - 新密码至少 8 位
 *   - 使用 bcrypt 哈希存储
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyPassword, hashPasswordBcrypt } from '@/lib/auth'
import { getSessionUser } from '@/lib/session-auth'
import { errorResponse, parseJsonBody, successResponse } from '@/lib/utils'

/** 最小密码长度 */
const MIN_PASSWORD_LENGTH = 8

interface ChangePasswordRequest {
  oldPassword: string
  newPassword: string
}

export async function PUT(request: NextRequest) {
  // 1. Session 认证
  const sessionResult = await getSessionUser()
  if (!sessionResult.success) {
    return errorResponse(
      sessionResult.error.code,
      sessionResult.error.message,
      sessionResult.error.status,
    )
  }

  const userId = sessionResult.user.id

  // 2. 解析请求体
  const { data, error: parseError } = await parseJsonBody<ChangePasswordRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
  }

  const { oldPassword, newPassword } = data

  if (!oldPassword || !newPassword) {
    return errorResponse('VALIDATION_ERROR', '旧密码和新密码不能为空', 422)
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return errorResponse('VALIDATION_ERROR', `新密码至少需要 ${MIN_PASSWORD_LENGTH} 位`, 422)
  }

  try {
    // 3. 查询用户当前密码哈希
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        passwordHash: true,
        passwordSalt: true,
      },
    })

    if (!user || !user.passwordHash) {
      return errorResponse('NOT_FOUND', '用户不存在或未设置密码', 404)
    }

    // 4. 验证旧密码
    const isOldPasswordValid = verifyPassword(
      oldPassword,
      user.passwordHash,
      user.passwordSalt,
    )

    if (!isOldPasswordValid) {
      return errorResponse('VALIDATION_ERROR', '旧密码不正确', 422)
    }

    // 5. 使用 bcrypt 哈希新密码并更新
    const newPasswordHash = hashPasswordBcrypt(newPassword)
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        passwordSalt: null, // bcrypt 不需要单独的 salt
      },
    })

    return successResponse({ message: '密码修改成功' })
  } catch (error) {
    console.error('Change password error:', error)
    return errorResponse('INTERNAL_ERROR', '修改密码失败，请稍后重试', 500)
  }
}
