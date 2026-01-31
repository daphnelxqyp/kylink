'use client'

import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { CONFIG_UPDATED_EVENT, getStoredApiKey } from '@/lib/api-client'

export default function NoApiKeyAlert() {
  const [hasApiKey, setHasApiKey] = useState(false)

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

