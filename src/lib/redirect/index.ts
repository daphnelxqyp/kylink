/**
 * 重定向追踪模块
 * 
 * 统一导出追踪器和验证器
 */

// 导出追踪器
export {
  RedirectTracker,
  extractDomain,
  isRedirectStatusCode,
  resolveUrl,
  // HTML 重定向提取
  extractHtmlRedirectUrl,
  // 单次请求函数
  singleRequest,
  // 完整重定向追踪
  trackRedirects,
  // 测试工具
  runHtmlRedirectTests,
  // 类型
  type IRedirectTracker,
  type TraceResult,
  type TrackerOptions,
  type HtmlRedirectResult,
  type SingleRequestOptions,
  type SingleRequestProxy,
  type SingleRequestResult,
  type TrackRedirectsOptions,
  type TrackRedirectsResult,
  type RedirectStepInfo,
  type DomainValidation,
} from './tracker'

// 导出域名验证器
export {
  DomainValidator,
  ValidationMode,
  // 核心工具函数
  extractRootDomain,
  normalizeDomain,
  validateDomain,
  // 兼容性函数
  extractBaseDomain,
  isValidDomain,
  isSameBaseDomain,
  // 测试工具
  runDomainValidatorTests,
  // 类型
  type IDomainValidator,
  type ValidatorOptions,
  type DomainValidateResult,
} from './domain-validator'

// 重新导出类型定义
export type {
  AffiliateVerifyRequest,
  AffiliateVerifyResponse,
  RedirectStep,
  RedirectType,
  ProxyRequestConfig,
  DomainValidationResult,
} from '@/types/affiliate-verify'

export { AFFILIATE_VERIFY_DEFAULTS, AffiliateVerifyErrorCode } from '@/types/affiliate-verify'

