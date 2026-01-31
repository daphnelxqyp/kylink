'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Col, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import { DatabaseOutlined, SyncOutlined } from '@ant-design/icons'
import { getJson, postJson } from '@/lib/api-client'
import type { StockCampaignStat, StockStatsResponse } from '@/types/dashboard'
import NoApiKeyAlert from '@/components/no-api-key-alert'

const { Title, Text } = Typography

export default function StockPage() {
  const [loading, setLoading] = useState(false)
  const [forceReplenish, setForceReplenish] = useState(false)
  const [stats, setStats] = useState<StockStatsResponse | null>(null)

  const loadStats = async () => {
    setLoading(true)
    try {
      const result = await getJson<StockStatsResponse>('/api/v1/jobs/replenish')
      setStats(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取库存失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStats()
  }, [])

  const handleReplenishAll = async () => {
    setLoading(true)
    try {
      await postJson('/api/v1/jobs/replenish', { mode: 'all' })
      message.success('已触发所有低水位补货')
      await loadStats()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '补货失败')
    } finally {
      setLoading(false)
    }
  }

  const handleReplenishSingle = async (campaignId: string) => {
    setLoading(true)
    try {
      await postJson('/api/v1/jobs/replenish', {
        mode: 'single',
        campaignId,
        force: forceReplenish,
      })
      message.success(`已触发 ${campaignId} 补货`)
      await loadStats()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '补货失败')
    } finally {
      setLoading(false)
    }
  }

  const summary = stats?.summary
  const campaigns = useMemo(() => stats?.campaigns || [], [stats])

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0 }}>
              库存管理
            </Title>
            <Text type="secondary">查看库存分布并手动触发补货</Text>
          </Col>
          <Col>
            <Space>
              <Button icon={<SyncOutlined />} onClick={loadStats} loading={loading}>
                刷新
              </Button>
              <Button type="primary" onClick={handleReplenishAll} loading={loading}>
                补货所有低水位
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <NoApiKeyAlert />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Campaign 总数"
              value={summary?.totalCampaigns || 0}
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="低库存 Campaign" value={summary?.lowStockCampaigns || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="可用库存总数" value={summary?.totalAvailable || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="租约中库存" value={summary?.totalLeased || 0} />
          </Card>
        </Col>
      </Row>

      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Checkbox checked={forceReplenish} onChange={e => setForceReplenish(e.target.checked)}>
            强制补货（忽略水位阈值）
          </Checkbox>
        </Space>
        <Table<StockCampaignStat>
          rowKey={record => `${record.userId}-${record.campaignId}`}
          loading={loading}
          dataSource={campaigns}
          columns={[
            { title: 'Campaign ID', dataIndex: 'campaignId' },
            {
              title: '可用库存',
              dataIndex: 'available',
              render: value => (value === 0 ? <Tag color="red">0</Tag> : value),
            },
            { title: '租约中', dataIndex: 'leased' },
            { title: '已消耗', dataIndex: 'consumed' },
            { title: '总计', dataIndex: 'total' },
            {
              title: '状态',
              dataIndex: 'needsReplenish',
              render: needs => (needs ? <Tag color="orange">需补货</Tag> : <Tag color="green">正常</Tag>),
            },
            {
              title: '操作',
              key: 'action',
              render: (_, record) => (
                <Button size="small" onClick={() => handleReplenishSingle(record.campaignId)}>
                  补货
                </Button>
              ),
            },
          ]}
          locale={{ emptyText: '暂无库存数据' }}
        />
      </Card>
    </Space>
  )
}

