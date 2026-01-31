/**
 * 统一错误处理模块
 *
 * 提供标准化的错误类型、错误处理和日志记录
 */

// ============================================
// 错误码定义
// ============================================

export const ErrorCodes = {
  // 认证错误 (401)
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  API_KEY_EXPIRED: 'API_KEY_EXPIRED',

  // 授权错误 (403)
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',

  // 资源错误 (404)
  NOT_FOUND: 'NOT_FOUND',
  CAMPAIGN_NOT_FOUND: 'CAMPAIGN_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  LEASE_NOT_FOUND: 'LEASE_NOT_FOUND',

  // 验证错误 (422)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_FORMAT: 'INVALID_FORMAT',
  MISSING_FIELD: 'MISSING_FIELD',

  // 业务错误 (400)
  NO_STOCK: 'NO_STOCK',
  PENDING_IMPORT: 'PENDING_IMPORT',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',

  // 限流错误 (429)
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // 服务器错误 (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

// ============================================
// 错误基类
// ============================================

/**
 * 应用错误基类
 */
export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly status: number
  public readonly details?: Record<string, unknown>
  public readonly timestamp: Date

  constructor(
    code: ErrorCode,
    message: string,
    status: number = 400,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
    this.timestamp = new Date()

    // 保持正确的原型链
    Object.setPrototypeOf(this, AppError.prototype)
  }

  /**
   * 转换为 JSON 响应格式
   */
  toJSON(): Record<string, unknown> {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    }
  }

  /**
   * 转换为 HTTP Response
   */
  toResponse(): Response {
    return Response.json(this.toJSON(), { status: this.status })
  }
}

// ============================================
// 具体错误类型
// ============================================

/**
 * 认证错误
 */
export class AuthenticationError extends AppError {
  constructor(message: string = '认证失败', code: ErrorCode = ErrorCodes.UNAUTHORIZED) {
    super(code, message, 401)
    this.name = 'AuthenticationError'
  }
}

/**
 * 授权错误
 */
export class AuthorizationError extends AppError {
  constructor(message: string = '无权访问', code: ErrorCode = ErrorCodes.FORBIDDEN) {
    super(code, message, 403)
    this.name = 'AuthorizationError'
  }
}

/**
 * 资源未找到错误
 */
export class NotFoundError extends AppError {
  constructor(resource: string = '资源', code: ErrorCode = ErrorCodes.NOT_FOUND) {
    super(code, `${resource}不存在`, 404)
    this.name = 'NotFoundError'
  }
}

/**
 * 验证错误
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    code: ErrorCode = ErrorCodes.VALIDATION_ERROR
  ) {
    super(code, message, 422, details)
    this.name = 'ValidationError'
  }

  /**
   * 创建缺少字段的验证错误
   */
  static missingFields(fields: string[]): ValidationError {
    return new ValidationError(`缺少必填字段: ${fields.join(', ')}`, { fields })
  }

  /**
   * 创建格式错误的验证错误
   */
  static invalidFormat(field: string, expected: string): ValidationError {
    return new ValidationError(`${field} 格式不正确，期望: ${expected}`, {
      field,
      expected,
    })
  }
}

/**
 * 业务逻辑错误
 */
export class BusinessError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(code, message, 400, details)
    this.name = 'BusinessError'
  }

  /**
   * 库存不足错误
   */
  static noStock(campaignId: string): BusinessError {
    return new BusinessError(ErrorCodes.NO_STOCK, '库存不足', { campaignId })
  }

  /**
   * 待导入错误
   */
  static pendingImport(campaignId: string): BusinessError {
    return new BusinessError(
      ErrorCodes.PENDING_IMPORT,
      'Campaign 未导入，请先同步或在请求中附带 meta',
      { campaignId }
    )
  }
}

/**
 * 内部服务错误
 */
export class InternalError extends AppError {
  public readonly originalError?: Error

  constructor(message: string = '服务器内部错误', originalError?: Error) {
    super(ErrorCodes.INTERNAL_ERROR, message, 500)
    this.name = 'InternalError'
    this.originalError = originalError
  }
}

/**
 * 数据库错误
 */
export class DatabaseError extends AppError {
  constructor(message: string = '数据库操作失败', originalError?: Error) {
    super(ErrorCodes.DATABASE_ERROR, message, 500, {
      originalMessage: originalError?.message,
    })
    this.name = 'DatabaseError'
  }
}

// ============================================
// 错误处理工具
// ============================================

/**
 * 将未知错误转换为 AppError
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }

  if (error instanceof Error) {
    // Prisma 错误处理
    if (error.name === 'PrismaClientKnownRequestError') {
      return new DatabaseError('数据库操作失败', error)
    }
    if (error.name === 'PrismaClientValidationError') {
      return new ValidationError('数据验证失败')
    }

    return new InternalError(error.message, error)
  }

  return new InternalError(String(error))
}

/**
 * 安全地记录错误（不泄露敏感信息）
 */
export function logError(
  error: AppError,
  context?: Record<string, unknown>
): void {
  const logData = {
    timestamp: error.timestamp.toISOString(),
    name: error.name,
    code: error.code,
    message: error.message,
    status: error.status,
    ...(context && { context }),
  }

  // 开发环境打印更多信息
  if (process.env.NODE_ENV === 'development') {
    console.error('[Error]', JSON.stringify(logData, null, 2))
    if (error instanceof InternalError && error.originalError) {
      console.error('[Stack]', error.originalError.stack)
    }
  } else {
    // 生产环境简洁日志
    console.error(`[Error] ${error.code}: ${error.message}`)
  }
}

// ============================================
// API 处理器包装器
// ============================================

import { NextRequest } from 'next/server'

type ApiHandler = (
  request: NextRequest,
  context?: { params?: Record<string, string> }
) => Promise<Response>

/**
 * API 路由错误处理包装器
 *
 * 用法：
 * export const GET = withErrorHandler(async (request) => {
 *   // 业务逻辑
 *   return successResponse({ data })
 * })
 */
export function withErrorHandler(handler: ApiHandler): ApiHandler {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (error) {
      const appError = normalizeError(error)

      // 记录错误
      logError(appError, {
        method: request.method,
        url: request.url,
        params: context?.params,
      })

      return appError.toResponse()
    }
  }
}

/**
 * 结合认证的 API 处理器包装器
 */
import { authenticateRequest, type AuthResult } from './auth'

type AuthenticatedHandler = (
  request: NextRequest,
  userId: string,
  context?: { params?: Record<string, string> }
) => Promise<Response>

export function withAuthAndErrorHandler(handler: AuthenticatedHandler): ApiHandler {
  return withErrorHandler(async (request, context) => {
    const authResult: AuthResult = await authenticateRequest(request)

    if (!authResult.success) {
      throw new AuthenticationError(
        authResult.error?.message || '认证失败',
        authResult.error?.code as ErrorCode || ErrorCodes.UNAUTHORIZED
      )
    }

    return handler(request, authResult.userId!, context)
  })
}
