'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Layout, Menu, Space, Typography, Button, Tag } from 'antd'
import {
  DashboardOutlined,
  SettingOutlined,
  DatabaseOutlined,
  AlertOutlined,
  SyncOutlined,
  UserOutlined,
  GlobalOutlined,
  LinkOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { useSession, signOut } from 'next-auth/react'
import { CONFIG_UPDATED_EVENT, getStoredApiKey, setCurrentUser } from '@/lib/api-client'
import { getAccessibleMenuKeys, type UserRole } from '@/lib/role-config'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

const allMenuItems = [
  { key: '/', label: '概览', icon: <DashboardOutlined /> },
  { key: '/links', label: '链接管理', icon: <LinkOutlined /> },
  { key: '/stock', label: '库存管理', icon: <DatabaseOutlined /> },
  { key: '/alerts', label: '告警中心', icon: <AlertOutlined /> },
  { key: '/jobs', label: '任务管理', icon: <SyncOutlined /> },
  { key: '/proxy-providers', label: '代理管理', icon: <GlobalOutlined /> },
  { key: '/users', label: '用户管理', icon: <UserOutlined /> },
  { key: '/settings', label: '设置', icon: <SettingOutlined /> },
]

function getSelectedKey(pathname: string): string {
  if (pathname === '/') return '/'
  const match = allMenuItems.find(item => pathname.startsWith(item.key))
  return match ? match.key : '/'
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [hasApiKey, setHasApiKey] = useState(false)
  const { data: session } = useSession()

  const selectedKey = useMemo(() => getSelectedKey(pathname), [pathname])

  // 根据用户角色过滤菜单项
  const filteredMenuItems = useMemo(() => {
    const userRole = (session?.user?.role as UserRole) || 'USER'
    const accessibleKeys = getAccessibleMenuKeys(userRole)
    return allMenuItems.filter(item => accessibleKeys.includes(item.key))
  }, [session?.user?.role])

  // 当 session 可用时，设置当前用户标记（用于 localStorage 键名隔离）
  useEffect(() => {
    if (session?.user?.email) {
      setCurrentUser(session.user.email)
    }
  }, [session?.user?.email])

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

  return (
    <Layout>
      <Sider width={220} breakpoint="lg" collapsedWidth={0}>
        <div style={{ padding: '16px 20px' }}>
          <Space align="center">
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#1677ff',
              }}
            />
            <Title level={4} style={{ margin: 0, color: '#fff' }}>
              KyAds SuffixPool
            </Title>
          </Space>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={filteredMenuItems}
          onClick={({ key }) => router.push(key)}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Space>
            <Text type="secondary">管理控制台</Text>
          </Space>
          <Space>
            {session?.user && (
              <>
                <Text>{session.user.email}</Text>
                {session.user.role === 'ADMIN' && <Tag color="blue">管理员</Tag>}
              </>
            )}
            {session?.user?.role !== 'ADMIN' && (
              hasApiKey
                ? <Tag color="green">API Key 已配置</Tag>
                : <Tag color="red">API Key 未配置</Tag>
            )}
            <Button
              icon={<LogoutOutlined />}
              onClick={() => signOut({ callbackUrl: '/login' })}
            >
              登出
            </Button>
          </Space>
        </Header>
        <Content>{children}</Content>
      </Layout>
    </Layout>
  )
}

