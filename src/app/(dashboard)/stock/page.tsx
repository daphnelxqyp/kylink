'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Button, Card, Checkbox, Col, Row, Space, Statistic, Table, Tag, Typography, message, Progress, Alert } from 'antd'
import { DatabaseOutlined, SyncOutlined, LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { getJson, postJson, getStoredApiKey } from '@/lib/api-client'
import type { StockCampaignStat, StockStatsResponse } from '@/types/dashboard'
import NoApiKeyAlert from '@/components/no-api-key-alert'

const { Title, Text } = Typography

/**
 * 补货进度类型（与后端 ReplenishProgress 对应）
 */
interface ReplenishProgress {
  stage: 'init' | 'processing' | 'done' | 'error'
  current: number
  total: number
  message: string
  currentCampaign?: string
}

export default function StockPage() {
  const [loading, setLoading] = useState(false)
  const [forceReplenish, setForceReplenish] = useState(false)
  const [stats, setStats] = useState<StockStatsResponse | null>(null)
  
  // 补货进度状态
  const [replenishing, setReplenishing] = useState(false)
  const [progress, setProgress] = useState<ReplenishProgress | null>(null)
  const [progressLogs, setProgressLogs] = useState<string[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

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

  /**
   * 使用 SSE 流式接口进行补货，实时显示进度
   */
  const handleReplenishAll = useCallback(async () => {
    // 重置状态
    setReplenishing(true)
    setProgress({ stage: 'init', current: 0, total: 0, message: '正在连接...' })
    setProgressLogs([])
    
    // 创建 AbortController 用于取消请求
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      // 获取 API Key 用于认证
      const apiKey = getStoredApiKey()
      if (!apiKey) {
        throw new Error('请先在设置页配置 API Key')
      }

      const response = await fetch('/api/v1/jobs/replenish/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ force: forceReplenish }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP 错误: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法获取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        
        // 解析 SSE 消息（格式：data: {...}\n\n）
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''  // 保留不完整的部分

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as ReplenishProgress
              setProgress(data)
              
              // 如果是处理中的消息，添加到日志
              if (data.stage === 'processing' && data.message) {
                setProgressLogs(prev => {
                  // 避免重复添加相同消息
                  if (prev.length > 0 && prev[prev.length - 1] === data.message) {
                    return prev
                  }
                  // 只保留最近 50 条日志
                  const newLogs = [...prev, data.message]
                  return newLogs.slice(-50)
                })
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      // 完成后刷新统计
      await loadStats()
      
      if (progress?.stage === 'done') {
        message.success('补货完成！')
      }

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        message.info('补货已取消')
      } else {
        message.error(error instanceof Error ? error.message : '补货失败')
        setProgress({
          stage: 'error',
          current: 0,
          total: 0,
          message: error instanceof Error ? error.message : '补货失败',
        })
      }
    } finally {
      setReplenishing(false)
      abortControllerRef.current = null
    }
  }, [forceReplenish, progress?.stage])

  /**
   * 取消补货
   */
  const handleCancelReplenish = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

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

  /**
   * 获取进度条状态
   */
  const getProgressStatus = () => {
    if (!progress) return undefined
    switch (progress.stage) {
      case 'error':
        return 'exception'
      case 'done':
        return 'success'
      default:
        return 'active'
    }
  }

  /**
   * 获取进度图标
   */
  const getProgressIcon = () => {
    if (!progress) return null
    switch (progress.stage) {
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
      case 'done':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />
      default:
        return <LoadingOutlined style={{ color: '#1890ff' }} />
    }
  }

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
              <Button icon={<SyncOutlined />} onClick={loadStats} loading={loading} disabled={replenishing}>
                刷新
              </Button>
              {replenishing ? (
                <Button danger onClick={handleCancelReplenish}>
                  取消补货
                </Button>
              ) : (
                <Button type="primary" onClick={handleReplenishAll} loading={loading}>
                  补货所有低水位
                </Button>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 补货进度面板 */}
      {(replenishing || progress) && (
        <Card 
          title={
            <Space>
              {getProgressIcon()}
              <span>补货进度</span>
            </Space>
          }
          extra={
            progress?.stage === 'done' || progress?.stage === 'error' ? (
              <Button size="small" onClick={() => { setProgress(null); setProgressLogs([]); }}>
                关闭
              </Button>
            ) : null
          }
        >
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            {/* 进度条 */}
            {progress && progress.total > 0 && (
              <Progress 
                percent={Math.round((progress.current / progress.total) * 100)} 
                status={getProgressStatus()}
                format={() => `${progress.current}/${progress.total}`}
              />
            )}
            
            {/* 当前状态消息 */}
            {progress && (
              <Alert 
                message={progress.message}
                type={
                  progress.stage === 'error' ? 'error' : 
                  progress.stage === 'done' ? 'success' : 
                  'info'
                }
                showIcon
              />
            )}

            {/* 进度日志（最近的处理记录） */}
            {progressLogs.length > 0 && (
              <div 
                style={{ 
                  maxHeight: 200, 
                  overflow: 'auto', 
                  background: '#f5f5f5', 
                  padding: '8px 12px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              >
                {progressLogs.map((log, index) => (
                  <div key={index} style={{ color: '#666', marginBottom: 2 }}>
                    {log}
                  </div>
                ))}
              </div>
            )}
          </Space>
        </Card>
      )}

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
            { 
              title: '广告系列名称', 
              dataIndex: 'campaignName',
              width: 280,
              ellipsis: true,
              render: (name: string | null, record: StockCampaignStat) => (
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
              title: '可用库存',
              dataIndex: 'available',
              width: 90,
              render: (value: number) => (value === 0 ? <Tag color="red">0</Tag> : value),
            },
            { title: '租约中', dataIndex: 'leased', width: 80 },
            { title: '已消耗', dataIndex: 'consumed', width: 80 },
            { title: '总计', dataIndex: 'total', width: 70 },
            {
              title: '状态',
              dataIndex: 'needsReplenish',
              width: 90,
              render: (needs: boolean) => (needs ? <Tag color="orange">需补货</Tag> : <Tag color="green">正常</Tag>),
            },
            {
              title: '操作',
              key: 'action',
              width: 80,
              render: (_: unknown, record: StockCampaignStat) => (
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

