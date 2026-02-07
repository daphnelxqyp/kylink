'use client'

import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { useSession } from 'next-auth/react'
import { CONFIG_UPDATED_EVENT, getStoredApiKey } from '@/lib/api-client'

/**
 * API Key 未配置提醒（仅对非管理员显示）
 *
 * 管理员后台无需配置 API Key，所以不展示此提醒。
 */
export default function NoApiKeyAlert() {
  const [hasApiKey, setHasApiKey] = useState(true) // 默认 true 避免闪烁
  const { data: session } = useSession()

  useEffect(() => {
    const refresh = () => setHasApiKey(!!getStoredApiKey())
    refresh()

    window.addEventListener('storage', refresh)
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh)

    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener(CONFIG_UPDATED_EVENT, refresh)
    }
  }, [])

  // 管理员无需 API Key，不显示提醒
  if (session?.user?.role === 'ADMIN') return null

  if (hasApiKey) return null

  return (
    <Alert
      type="warning"
      message="尚未配置 API Key"
      description="请先在设置页面填写 API Key，页面数据才能正常加载。"
      action={
        <Button type="primary" href="/settings">
          去设置
        </Button>
      }
      showIcon
    />
  )
}

