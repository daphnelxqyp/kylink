/**
 * 角色权限配置
 *
 * 定义用户角色的菜单访问权限和路由保护规则
 */

export type UserRole = 'ADMIN' | 'USER'

/**
 * 各角色可访问的菜单路径
 */
export const ROLE_MENU_ACCESS: Record<UserRole, string[]> = {
  USER: ['/', '/links', '/stock', '/leases', '/alerts', '/settings'],
  ADMIN: ['/', '/links', '/stock', '/leases', '/alerts', '/jobs', '/proxy-providers', '/users', '/settings'],
}

/**
 * 仅管理员可访问的页面路由
 */
export const ADMIN_ONLY_ROUTES = ['/jobs', '/proxy-providers', '/users']

/**
 * 仅管理员可访问的 API 路由
 * 注意：/api/v1/jobs/replenish 和 /api/v1/jobs/alerts 对普通用户开放（供 /stock 和 /alerts 页面使用）
 */
export const ADMIN_ONLY_API_ROUTES = [
  '/api/v1/admin/users',
  '/api/v1/admin/proxy-providers',
  '/api/v1/jobs/stock-cleanup',
  '/api/v1/jobs/lease-recovery',
  '/api/v1/jobs/recovery',
]

/**
 * 检查页面路由是否为管理员专属
 */
export function isAdminOnlyRoute(pathname: string): boolean {
  return ADMIN_ONLY_ROUTES.some(route => pathname.startsWith(route))
}

/**
 * 检查 API 路由是否为管理员专属
 */
export function isAdminOnlyApiRoute(pathname: string): boolean {
  return ADMIN_ONLY_API_ROUTES.some(route => pathname.startsWith(route))
}

/**
 * 获取指定角色可访问的菜单路径列表
 */
export function getAccessibleMenuKeys(role: UserRole): string[] {
  return ROLE_MENU_ACCESS[role] || ROLE_MENU_ACCESS.USER
}
