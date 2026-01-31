'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Col, Row, Space, Statistic, Typography, message } from 'antd'
import { getJson, postJson } from '@/lib/api-client'
import type { LeaseHealthResponse } from '@/types/dashboard'
import NoApiKeyAlert from '@/components/no-api-key-alert'

const { Title, Text } = Typography

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return value.toString()
}

export default function LeasesPage() {
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<LeaseHealthResponse | null>(null)
  const [lastAction, setLastAction] = useState<string>('-')

  const loadHealth = async () => {
    setLoading(true)
    try {
      const result = await getJson<LeaseHealthResponse>('/api/v1/jobs/recovery')
      setHealth(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取健康状态失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHealth()
  }, [])

  const runAction = async (action: 'recover_leases' | 'cleanup_stock' | 'all', label: string) => {
    setLoading(true)
    try {
      await postJson('/api/v1/jobs/recovery', { action })
      setLastAction(label)
      message.success(`${label}已触发`)
      await loadHealth()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0 }}>
              租约回收
            </Title>
            <Text type="secondary">查看租约健康状态并执行回收任务</Text>
          </Col>
          <Col>
            <Space>
              <Button onClick={loadHealth} loading={loading}>
                刷新状态
              </Button>
              <Button type="primary" onClick={() => runAction('recover_leases', '租约回收')} loading={loading}>
                执行租约回收
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <NoApiKeyAlert />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="活跃租约" value={health?.health.activeLease || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="已过期租约" value={health?.health.expiredLeases || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="失败租约" value={health?.health.failedLeases || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="最旧租约分钟数"
              value={formatNumber(health?.health.oldestActiveMinutes ?? null)}
            />
          </Card>
        </Col>
      </Row>

      <Card title="可用操作">
        <Space wrap>
          <Button onClick={() => runAction('recover_leases', '租约回收')} loading={loading}>
            回收超时租约
          </Button>
          <Button onClick={() => runAction('cleanup_stock', '库存清理')} loading={loading}>
            清理过期库存
          </Button>
          <Button type="primary" onClick={() => runAction('all', '租约回收+清理')} loading={loading}>
            一键执行全部
          </Button>
        </Space>
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">最近操作：</Text>
          <Text>{lastAction}</Text>
        </div>
      </Card>
    </Space>
  )
}

