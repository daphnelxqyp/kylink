import type { Metadata } from 'next'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import SessionProvider from '@/components/providers/session-provider'
import './globals.css'

// Ant Design 主题配置
const antdTheme = {
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 6,
  },
}

export const metadata: Metadata = {
  title: 'KyAds SuffixPool',
  description: 'Google Ads Scripts 自动写入 Final URL Suffix 系统',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <SessionProvider>
          <AntdRegistry>
            <ConfigProvider locale={zhCN} theme={antdTheme}>
              {children}
            </ConfigProvider>
          </AntdRegistry>
        </SessionProvider>
      </body>
    </html>
  )
}

