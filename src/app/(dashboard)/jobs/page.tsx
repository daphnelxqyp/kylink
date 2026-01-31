'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Row, Space, Table, Tag, Typography, message } from 'antd'
import { getJson, postJson } from '@/lib/api-client'
import type { JobHistoryItem, JobItem, JobStatusResponse } from '@/types/dashboard'
import NoApiKeyAlert from '@/components/no-api-key-alert'

const { Title, Text } = Typography

function formatDateTime(value?: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

export default function JobsPage() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<JobStatusResponse | null>(null)

  const loadStatus = async () => {
    setLoading(true)
    try {
      const result = await getJson<JobStatusResponse>('/api/v1/jobs')
      setStatus(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取任务状态失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const handleRunAll = async () => {
    setLoading(true)
    try {
      await postJson('/api/v1/jobs', {})
      message.success('已触发全部任务')
      await loadStatus()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '执行失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRunJob = async (jobName: string) => {
    setLoading(true)
    try {
      await postJson('/api/v1/jobs', { jobName, immediate: true })
      message.success(`已触发任务：${jobName}`)
      await loadStatus()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '执行失败')
    } finally {
      setLoading(false)
    }
  }

  const jobs = useMemo(() => status?.jobs || [], [status])
  const history = useMemo(() => status?.history || [], [status])

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0 }}>
              任务管理
            </Title>
            <Text type="secondary">查看定时任务状态并手动触发</Text>
          </Col>
          <Col>
            <Space>
              <Button onClick={loadStatus} loading={loading}>
                刷新
              </Button>
              <Button type="primary" onClick={handleRunAll} loading={loading}>
                执行全部
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <NoApiKeyAlert />

      <Card title="任务列表">
        <Table<JobItem>
          rowKey="name"
          loading={loading}
          dataSource={jobs}
          columns={[
            { title: '任务', dataIndex: 'name' },
            { title: '说明', dataIndex: 'description' },
            { title: '频率(分钟)', dataIndex: 'intervalMinutes', width: 120 },
            {
              title: '状态',
              dataIndex: 'enabled',
              render: enabled => (enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
              width: 100,
            },
            { title: '上次运行', dataIndex: 'lastRun', render: formatDateTime, width: 180 },
            { title: '下次运行', dataIndex: 'nextRun', render: formatDateTime, width: 180 },
            {
              title: '操作',
              key: 'action',
              render: (_, record) => (
                <Button size="small" onClick={() => handleRunJob(record.name)}>
                  立即执行
                </Button>
              ),
              width: 120,
            },
          ]}
          locale={{ emptyText: '暂无任务数据' }}
        />
      </Card>

      <Card title="最近执行记录">
        <Table<JobHistoryItem>
          rowKey={(record, index) => `${record.jobName}-${index}`}
          loading={loading}
          dataSource={history}
          columns={[
            { title: '任务', dataIndex: 'jobName' },
            { title: '开始时间', dataIndex: 'startedAt', render: formatDateTime, width: 180 },
            { title: '结束时间', dataIndex: 'completedAt', render: formatDateTime, width: 180 },
            {
              title: '耗时(ms)',
              dataIndex: 'duration',
              width: 120,
            },
            {
              title: '结果',
              dataIndex: 'success',
              render: success => (success ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>),
              width: 100,
            },
            {
              title: '错误',
              dataIndex: 'error',
              render: error => error || '-',
            },
          ]}
          locale={{ emptyText: '暂无执行记录' }}
        />
      </Card>
    </Space>
  )
}

