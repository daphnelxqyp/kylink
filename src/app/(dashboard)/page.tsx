'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Progress, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import {
  AlertOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  EyeOutlined,
  MinusCircleOutlined,
  SwapOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useSession } from 'next-auth/react'
import { CONFIG_UPDATED_EVENT, getJson, getStoredApiKey } from '@/lib/api-client'
import type {
  AlertItem,
  AlertResponse,
  EmployeeDashboardStats,
  JobStatusResponse,
  RecentAssignmentItem,
  StockStatsResponse,
} from '@/types/dashboard'
import type { UserRole } from '@/lib/role-config'
import NoApiKeyAlert from '@/components/no-api-key-alert'

const { Title, Text } = Typography

/**
 * 格式化日期时间
 */
function formatDateTime(value?: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

// ====================================================
// 管理员概览组件（保持原有逻辑）
// ====================================================

function AdminDashboard() {
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

// ====================================================
// 员工概览组件（全新设计）
// ====================================================

function EmployeeDashboard() {
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<EmployeeDashboardStats | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)

  const loadData = async () => {
    if (!getStoredApiKey()) return
    setLoading(true)
    try {
      const data = await getJson<EmployeeDashboardStats>('/api/v1/dashboard/stats')
      setStats(data)
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

  /** 库存进度百分比 */
  const stockPercent = useMemo(() => {
    if (!stats) return 0
    const total = stats.stockAvailable + stats.stockConsumed
    if (total === 0) return 0
    return Math.round((stats.stockAvailable / total) * 100)
  }, [stats])

  /** 写入成功率渲染颜色 */
  const writeRateColor = useMemo(() => {
    if (stats?.writeSuccessRate == null) return '#1677ff'
    if (stats.writeSuccessRate >= 95) return '#52c41a'
    if (stats.writeSuccessRate >= 80) return '#faad14'
    return '#ff4d4f'
  }, [stats])

  /** 写入状态 Tag */
  const renderWriteStatus = (_: unknown, record: RecentAssignmentItem) => {
    if (record.writeSuccess === null) {
      return <Tag icon={<MinusCircleOutlined />} color="default">待回传</Tag>
    }
    return record.writeSuccess
      ? <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
      : <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>
  }

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      {/* 页头 */}
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0 }}>
              工作台
            </Title>
            <Text type="secondary">今日换链状态与核心指标一览</Text>
          </Col>
          <Col>
            <Button icon={<SyncOutlined />} loading={loading} onClick={loadData}>
              刷新数据
            </Button>
          </Col>
        </Row>
      </Card>

      {!hasApiKey && <NoApiKeyAlert />}

      {/* 第一行：4 个核心卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="广告系列总数"
              value={stats?.totalCampaigns ?? 0}
              prefix={<DashboardOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日换链次数"
              value={stats?.todayAssignments ?? 0}
              prefix={<SwapOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日写入成功率"
              value={stats?.writeSuccessRate ?? '-'}
              suffix={stats?.writeSuccessRate != null ? '%' : ''}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: writeRateColor }}
            />
            {stats?.todayWriteTotal != null && stats.todayWriteTotal > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {stats.todayWriteSuccess}/{stats.todayWriteTotal} 次
              </Text>
            )}
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="低库存广告系列"
              value={stats?.lowStockCampaigns ?? 0}
              prefix={<WarningOutlined />}
              valueStyle={{
                color: (stats?.lowStockCampaigns ?? 0) > 0 ? '#ff4d4f' : '#52c41a',
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* 第二行：库存概览 + 点击概览 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<><DatabaseOutlined style={{ marginRight: 8 }} />库存概览</>}>
            <Row gutter={16} align="middle">
              <Col span={10}>
                <Progress
                  type="dashboard"
                  percent={stockPercent}
                  size={120}
                  strokeColor={stockPercent > 30 ? '#52c41a' : stockPercent > 10 ? '#faad14' : '#ff4d4f'}
                  format={() => (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 600 }}>{stats?.stockAvailable ?? 0}</div>
                      <div style={{ fontSize: 12, color: '#8c8c8c' }}>可用</div>
                    </div>
                  )}
                />
              </Col>
              <Col span={14}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div>
                    <Text type="secondary">可用库存</Text>
                    <div style={{ fontSize: 20, fontWeight: 600, color: '#52c41a' }}>
                      {stats?.stockAvailable ?? 0}
                    </div>
                  </div>
                  <div>
                    <Text type="secondary">已消耗库存</Text>
                    <div style={{ fontSize: 20, fontWeight: 600, color: '#8c8c8c' }}>
                      {stats?.stockConsumed ?? 0}
                    </div>
                  </div>
                </Space>
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<><ThunderboltOutlined style={{ marginRight: 8 }} />点击概览</>}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic
                  title="总观测点击"
                  value={stats?.totalObservedClicks ?? 0}
                  prefix={<EyeOutlined />}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="已换链点击"
                  value={stats?.totalAppliedClicks ?? 0}
                  prefix={<CloudOutlined />}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
            </Row>
            {stats && stats.totalObservedClicks > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  换链覆盖率：
                  {Math.round((stats.totalAppliedClicks / stats.totalObservedClicks) * 100)}%
                </Text>
                <Progress
                  percent={Math.round((stats.totalAppliedClicks / stats.totalObservedClicks) * 100)}
                  showInfo={false}
                  strokeColor="#1677ff"
                  size="small"
                  style={{ marginTop: 4 }}
                />
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 第三行：最近换链记录 */}
      <Card title="最近换链记录">
        <Table<RecentAssignmentItem>
          rowKey="id"
          size="small"
          pagination={false}
          loading={loading}
          dataSource={stats?.recentAssignments || []}
          columns={[
            {
              title: '时间',
              dataIndex: 'assignedAt',
              width: 160,
              render: formatDateTime,
            },
            {
              title: '广告系列',
              dataIndex: 'campaignName',
              ellipsis: true,
              render: (name: string | null, record: RecentAssignmentItem) =>
                name || record.campaignId,
            },
            {
              title: '写入状态',
              dataIndex: 'writeSuccess',
              width: 100,
              render: renderWriteStatus,
            },
            {
              title: 'Suffix',
              dataIndex: 'finalUrlSuffix',
              ellipsis: true,
              render: (text: string) => (
                <Text copyable style={{ fontSize: 12 }} code>
                  {text}
                </Text>
              ),
            },
          ]}
          locale={{ emptyText: '暂无换链记录' }}
        />
      </Card>
    </Space>
  )
}

// ====================================================
// 主页面：根据角色切换
// ====================================================

export default function DashboardPage() {
  const { data: session } = useSession()
  const role = (session?.user?.role as UserRole) || 'USER'

  if (role === 'ADMIN') {
    return <AdminDashboard />
  }

  return <EmployeeDashboard />
}
