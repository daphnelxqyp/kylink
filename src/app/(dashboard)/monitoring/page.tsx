'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import {
  SyncOutlined,
  LineChartOutlined,
  SwapOutlined,
  CheckCircleOutlined,
  PercentageOutlined
} from '@ant-design/icons'
import { getJson } from '@/lib/api-client'
import type { LinkChangeMonitoringResponse, CampaignLinkChangeStat } from '@/types/monitoring'
import dayjs from 'dayjs'

const { Title, Text } = Typography

export default function MonitoringPage() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<LinkChangeMonitoringResponse['data'] | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const result = await getJson<LinkChangeMonitoringResponse>('/api/v1/monitoring/link-changes')
      setData(result.data)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const summary = data?.summary
  const campaigns = data?.campaigns || []

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      {/* 顶部标题和刷新按钮 */}
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0 }}>
              换链监控
            </Title>
            <Text type="secondary">查看今日换链统计</Text>
          </Col>
          <Col>
            <Button
              icon={<SyncOutlined />}
              onClick={loadData}
              loading={loading}
            >
              刷新
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日总点击数"
              value={summary?.totalClicks || 0}
              prefix={<LineChartOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日总换链次数"
              value={summary?.totalAssignments || 0}
              prefix={<SwapOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日总成功次数"
              value={summary?.totalSuccess || 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日成功率"
              value={summary?.successRate || 0}
              suffix="%"
              prefix={<PercentageOutlined />}
              valueStyle={{ color: '#722ed1' }}
              precision={1}
            />
          </Card>
        </Col>
      </Row>

      {/* Campaign 明细表格 */}
      <Card>
        <Table<CampaignLinkChangeStat>
          rowKey="campaignId"
          loading={loading}
          dataSource={campaigns}
          columns={[
            {
              title: '广告系列名称',
              dataIndex: 'campaignName',
              width: 280,
              ellipsis: true,
              render: (name: string | null, record: CampaignLinkChangeStat) => (
                <Text ellipsis style={{ maxWidth: 260 }} title={name || record.campaignId}>
                  {name || <Text type="secondary">{record.campaignId}</Text>}
                </Text>
              ),
            },
            {
              title: 'Campaign ID',
              dataIndex: 'campaignId',
              width: 130,
            },
            {
              title: '今日点击',
              dataIndex: 'todayClicks',
              width: 90,
              sorter: (a, b) => a.todayClicks - b.todayClicks,
            },
            {
              title: '换链次数',
              dataIndex: 'todayAssignments',
              width: 90,
              sorter: (a, b) => a.todayAssignments - b.todayAssignments,
            },
            {
              title: '成功',
              dataIndex: 'successCount',
              width: 70,
              sorter: (a, b) => a.successCount - b.successCount,
              render: (value: number) => (
                <Text style={{ color: '#52c41a' }}>{value}</Text>
              ),
            },
            {
              title: '失败',
              dataIndex: 'failureCount',
              width: 70,
              sorter: (a, b) => a.failureCount - b.failureCount,
              render: (value: number) => (
                value > 0 ? <Tag color="red">{value}</Tag> : value
              ),
            },
            {
              title: '成功率',
              dataIndex: 'successRate',
              width: 90,
              sorter: (a, b) => a.successRate - b.successRate,
              render: (value: number) => `${value.toFixed(1)}%`,
            },
            {
              title: '最后换链时间',
              dataIndex: 'lastAssignedAt',
              width: 160,
              render: (date: Date | null) => (
                date ? dayjs(date).format('HH:mm:ss') : '-'
              ),
            },
          ]}
          locale={{ emptyText: '暂无换链记录' }}
          pagination={{
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个广告系列`,
          }}
        />
      </Card>
    </Space>
  )
}
