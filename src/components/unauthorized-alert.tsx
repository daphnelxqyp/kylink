'use client'

/**
 * 未授权访问提示组件
 *
 * 监听 URL 中的 error=unauthorized 参数，显示权限不足提示
 */

import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { message } from 'antd'

export default function UnauthorizedAlert() {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const error = searchParams.get('error')

    if (error === 'unauthorized') {
      message.error('权限不足，无法访问该页面')

      // 清理 URL 中的 error 参数
      const url = new URL(window.location.href)
      url.searchParams.delete('error')
      router.replace(url.pathname + url.search)
    }
  }, [searchParams, router])

  return null
}
