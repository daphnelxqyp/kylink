'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import {
  SyncOutlined,
  LineChartOutlined,
  SwapOutlined,
  CheckCircleOutlined,
  PercentageOutlined,
  DatabaseOutlined,  // 新增
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
        {/* 新增：总广告系列 */}
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="总广告系列"
              value={summary?.totalCampaigns || 0}
              suffix="个"
              prefix={<DatabaseOutlined />}
              valueStyle={{ color: '#13c2c2' }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日点击总数"
              value={summary?.totalClicks || 0}
              prefix={<LineChartOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日换链次数"
              value={summary?.totalAssignments || 0}
              prefix={<SwapOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="换链成功率"
              value={summary?.successRate || 0}
              suffix="%"
              prefix={<PercentageOutlined />}
              valueStyle={{ color: '#52c41a' }}
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
              sorter: (a, b) => (a.successRate || 0) - (b.successRate || 0),
              render: (value: number | null) => (
                value !== null ? `${value.toFixed(1)}%` : '-'
              ),
            },
            {
              title: '最后换链时间',
              dataIndex: 'lastAssignedAt',
              width: 160,
              render: (date: Date | null) => (
                date ? dayjs(date).format('MM-DD HH:mm:ss') : '-'
              ),
            },
            {
              title: '最后监控时间',
              dataIndex: 'lastMonitoredAt',
              width: 160,
              sorter: (a, b) => {
                if (!a.lastMonitoredAt) return 1
                if (!b.lastMonitoredAt) return -1
                return new Date(b.lastMonitoredAt).getTime() - new Date(a.lastMonitoredAt).getTime()
              },
              defaultSortOrder: 'descend',
              render: (date: Date | null) => (
                date ? dayjs(date).format('MM-DD HH:mm:ss') : '-'
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
