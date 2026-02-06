'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Row, Space, Statistic, Table, Typography, message } from 'antd'
import {
  AlertOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { CONFIG_UPDATED_EVENT, getJson, getStoredApiKey } from '@/lib/api-client'
import type {
  AlertItem,
  AlertResponse,
  JobStatusResponse,
  StockStatsResponse,
} from '@/types/dashboard'
import NoApiKeyAlert from '@/components/no-api-key-alert'

const { Title, Text } = Typography

function formatDateTime(value?: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(false)
  const [stockStats, setStockStats] = useState<StockStatsResponse | null>(null)
  const [alertData, setAlertData] = useState<AlertResponse | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)

  const loadData = async () => {
    if (!getStoredApiKey()) {
      return
    }
    setLoading(true)
    try {
      const [stock, alerts, jobs] = await Promise.all([
        getJson<StockStatsResponse>('/api/v1/jobs/replenish'),
        getJson<AlertResponse>('/api/v1/jobs/alerts'),
        getJson<JobStatusResponse>('/api/v1/jobs'),
      ])
      setStockStats(stock)
      setAlertData(alerts)
      setJobStatus(jobs)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : '获取数据失败'
      message.error(messageText)
    } finally {
      setLoading(false)
    }
  }

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

  useEffect(() => {
    if (hasApiKey) {
      loadData()
    }
  }, [hasApiKey])

  const lowStockList = useMemo(() => {
    if (!stockStats?.campaigns) return []
    return stockStats.campaigns.filter(item => item.needsReplenish).slice(0, 5)
  }, [stockStats])

  const recentAlerts = useMemo(() => {
    return alertData?.history?.slice(0, 5) || []
  }, [alertData])

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0 }}>
              管理概览
            </Title>
            <Text type="secondary">核心指标与最新状态一览</Text>
          </Col>
          <Col>
            <Button icon={<SyncOutlined />} loading={loading} onClick={loadData}>
              刷新数据
            </Button>
          </Col>
        </Row>
      </Card>

      {!hasApiKey && <NoApiKeyAlert />}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Campaign 总数"
              value={stockStats?.summary.totalCampaigns || 0}
              prefix={<DashboardOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="可用库存"
              value={stockStats?.summary.totalAvailable || 0}
              prefix={<DatabaseOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="低库存 Campaign"
              value={stockStats?.summary.lowStockCampaigns || 0}
              prefix={<SyncOutlined />}
              valueStyle={{ color: (stockStats?.summary.lowStockCampaigns || 0) > 0 ? '#ff4d4f' : '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="未确认告警"
              value={alertData?.stats.unacknowledged || 0}
              prefix={<AlertOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="库存不足的 Campaign（Top 5）">
            <Table
              rowKey="campaignId"
              size="small"
              pagination={false}
              loading={loading}
              dataSource={lowStockList}
              columns={[
                { title: 'Campaign ID', dataIndex: 'campaignId' },
                { title: '可用库存', dataIndex: 'available' },
              ]}
              locale={{ emptyText: '当前没有库存不足的 Campaign' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="最近告警（Top 5）">
            <Table<AlertItem>
              rowKey="id"
              size="small"
              pagination={false}
              loading={loading}
              dataSource={recentAlerts}
              columns={[
                { title: '级别', dataIndex: 'level', width: 80 },
                { title: '标题', dataIndex: 'title' },
                { title: '时间', dataIndex: 'createdAt', render: formatDateTime, width: 160 },
              ]}
              locale={{ emptyText: '暂无告警记录' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="任务运行状态">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Text type="secondary">任务数量</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>
              {jobStatus?.jobs.length || 0}
            </div>
          </Col>
          <Col xs={24} md={8}>
            <Text type="secondary">最近执行时间</Text>
            <div style={{ fontSize: 16 }}>
              {formatDateTime(jobStatus?.history?.[0]?.completedAt)}
            </div>
          </Col>
          <Col xs={24} md={8}>
            <Text type="secondary">最近执行结果</Text>
            <div style={{ fontSize: 16 }}>
              {jobStatus?.history?.[0]?.success ? '成功' : jobStatus?.history?.length ? '失败' : '-'}
            </div>
          </Col>
        </Row>
      </Card>
    </Space>
  )
}

