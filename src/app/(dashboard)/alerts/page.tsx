'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import { getJson, postJson } from '@/lib/api-client'
import type { AlertItem, AlertResponse, AlertLevel } from '@/types/dashboard'
import NoApiKeyAlert from '@/components/no-api-key-alert'

const { Title, Text } = Typography

function formatDateTime(value?: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

const levelColor: Record<AlertLevel, string> = {
  info: 'blue',
  warning: 'orange',
  critical: 'red',
}

export default function AlertsPage() {
  const [loading, setLoading] = useState(false)
  const [alertData, setAlertData] = useState<AlertResponse | null>(null)
  const [levelFilter, setLevelFilter] = useState<AlertLevel | 'all'>('all')

  const loadAlerts = async () => {
    setLoading(true)
    try {
      const query = levelFilter === 'all' ? '' : `?level=${levelFilter}`
      const result = await getJson<AlertResponse>(`/api/v1/jobs/alerts${query}`)
      setAlertData(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取告警失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [levelFilter])

  const handleCheck = async () => {
    setLoading(true)
    try {
      await postJson('/api/v1/jobs/alerts', { action: 'check' })
      message.success('告警检查已触发')
      await loadAlerts()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '触发失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAcknowledge = async (alertId: string) => {
    setLoading(true)
    try {
      await postJson('/api/v1/jobs/alerts', { action: 'acknowledge', alertId })
      message.success('告警已确认')
      await loadAlerts()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '确认失败')
    } finally {
      setLoading(false)
    }
  }

  const stats = alertData?.stats
  const dataSource = useMemo(() => alertData?.history || [], [alertData])

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0 }}>
              告警中心
            </Title>
            <Text type="secondary">查看告警历史与确认处理</Text>
          </Col>
          <Col>
            <Space>
              <Select
                value={levelFilter}
                style={{ width: 140 }}
                onChange={value => setLevelFilter(value)}
                options={[
                  { value: 'all', label: '全部级别' },
                  { value: 'info', label: '信息' },
                  { value: 'warning', label: '警告' },
                  { value: 'critical', label: '严重' },
                ]}
              />
              <Button onClick={loadAlerts} loading={loading}>
                刷新
              </Button>
              <Button type="primary" onClick={handleCheck} loading={loading}>
                手动检查
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <NoApiKeyAlert />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Text type="secondary">告警总数</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{stats?.total || 0}</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Text type="secondary">未确认</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{stats?.unacknowledged || 0}</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Text type="secondary">严重告警</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{stats?.byLevel?.critical || 0}</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Text type="secondary">警告告警</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{stats?.byLevel?.warning || 0}</div>
          </Card>
        </Col>
      </Row>

      <Card title="告警列表">
        <Table<AlertItem>
          rowKey="id"
          loading={loading}
          dataSource={dataSource}
          columns={[
            {
              title: '级别',
              dataIndex: 'level',
              render: (level: AlertLevel) => <Tag color={levelColor[level]}>{level}</Tag>,
              width: 100,
            },
            { title: '标题', dataIndex: 'title' },
            { title: '详情', dataIndex: 'message' },
            { title: '时间', dataIndex: 'createdAt', render: formatDateTime, width: 180 },
            {
              title: '状态',
              dataIndex: 'acknowledged',
              render: value => (value ? <Tag>已确认</Tag> : <Tag color="orange">未确认</Tag>),
              width: 100,
            },
            {
              title: '操作',
              key: 'action',
              render: (_, record) =>
                record.acknowledged ? (
                  <Text type="secondary">-</Text>
                ) : (
                  <Button size="small" onClick={() => handleAcknowledge(record.id)}>
                    确认
                  </Button>
                ),
            },
          ]}
          locale={{ emptyText: '暂无告警记录' }}
        />
      </Card>
    </Space>
  )
}

