'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  message,
  Modal,
  Row,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Timeline,
  Typography,
  Tooltip,
  Divider,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudDownloadOutlined,
  EditOutlined,
  GlobalOutlined,
  LinkOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import {
  getJsonPublic,
  getStoredSpreadsheetIds,
  postJsonPublic,
  putJsonPublic,
} from '@/lib/api-client'
import type {
  CampaignItem,
  CampaignListResponse,
} from '@/types/dashboard'
import type {
  AffiliateVerifyResponse,
  RedirectStep,
} from '@/types/affiliate-verify'
import NoApiKeyAlert from '@/components/no-api-key-alert'

const { Title, Text, Link } = Typography

// ================= 工具函数 =================

/**
 * 从 URL 或域名中提取域名显示
 */
function extractDomain(url: string | null): string {
  if (!url) return '-'
  const trimmed = url.trim()
  if (!trimmed) return '-'
  
  // 如果是纯域名（不含协议），直接返回
  if (!trimmed.includes('://') && !trimmed.startsWith('/')) {
    // 去掉可能的路径部分
    return trimmed.split('/')[0]
  }
  
  // 尝试解析完整 URL
  try {
    const urlObj = new URL(trimmed)
    return urlObj.hostname
  } catch {
    // 解析失败，尝试直接返回
    return trimmed.split('/')[0]
  }
}

/**
 * 截断 URL 显示
 */
function truncateUrl(url: string | null, maxLength: number = 30): string {
  if (!url) return '-'
  if (url.length <= maxLength) return url
  return url.substring(0, maxLength) + '...'
}

/**
 * 获取重定向类型的标签颜色和文字
 */
function getRedirectTypeInfo(type?: string): { color: string; text: string } {
  switch (type) {
    case 'http':
      return { color: 'blue', text: 'HTTP' }
    case 'meta':
      return { color: 'orange', text: 'Meta' }
    case 'js':
      return { color: 'purple', text: 'JS' }
    default:
      return { color: 'default', text: '终点' }
  }
}

/**
 * 获取状态码的颜色
 */
function getStatusCodeColor(statusCode?: number): string {
  if (!statusCode) return 'default'
  if (statusCode >= 200 && statusCode < 300) return 'success'
  if (statusCode >= 300 && statusCode < 400) return 'processing'
  if (statusCode >= 400 && statusCode < 500) return 'warning'
  if (statusCode >= 500) return 'error'
  return 'default'
}

// ================= 验证结果展示组件 =================

interface VerifyResultProps {
  result: AffiliateVerifyResponse
}

function VerifyResultDisplay({ result }: VerifyResultProps) {
  return (
    <div style={{ marginTop: 16 }}>
      <Divider style={{ margin: '12px 0' }}>验证结果</Divider>
      
      {/* 状态概览 */}
      <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Space>
            <Text type="secondary">状态：</Text>
            {result.success ? (
              <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
            ) : (
              <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>
            )}
          </Space>
        </Col>
        <Col span={12}>
          <Space>
            <Text type="secondary">域名匹配：</Text>
            {result.matched ? (
              <Tag icon={<CheckCircleOutlined />} color="success">匹配</Tag>
            ) : (
              <Tag icon={<CloseCircleOutlined />} color="warning">不匹配</Tag>
            )}
          </Space>
        </Col>
      </Row>

      {/* 最终落地信息 */}
      <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
        <Row gutter={[16, 8]}>
          <Col span={24}>
            <Text type="secondary">最终域名：</Text>
            <Text strong code style={{ marginLeft: 8 }}>{result.finalDomain || '-'}</Text>
          </Col>
          <Col span={24}>
            <Text type="secondary">最终 URL：</Text>
            <Tooltip title={result.finalUrl}>
              <Link 
                href={result.finalUrl} 
                target="_blank" 
                style={{ marginLeft: 8, wordBreak: 'break-all' }}
              >
                {truncateUrl(result.finalUrl || '', 50)}
              </Link>
            </Tooltip>
          </Col>
          <Col span={12}>
            <Text type="secondary">重定向次数：</Text>
            <Text strong style={{ marginLeft: 8 }}>{result.totalRedirects}</Text>
          </Col>
          <Col span={12}>
            <Text type="secondary">耗时：</Text>
            <Text strong style={{ marginLeft: 8 }}>{result.duration || 0} ms</Text>
          </Col>
          <Col span={24}>
            <Text type="secondary">代理出口：</Text>
            {result.proxyIp ? (
              <Tag color="blue" style={{ marginLeft: 8 }}>{result.proxyIp}</Tag>
            ) : (
              <Tag color="default" style={{ marginLeft: 8 }}>直连（无代理）</Tag>
            )}
          </Col>
        </Row>
      </Card>

      {/* 错误信息 */}
      {result.error && (
        <Card size="small" style={{ marginBottom: 16, background: '#fff2f0', borderColor: '#ffccc7' }}>
          <Text type="danger">
            <CloseCircleOutlined style={{ marginRight: 8 }} />
            {result.error.length > 200 ? result.error.slice(0, 200) + '...' : result.error}
          </Text>
        </Card>
      )}

      {/* 代理尝试记录 */}
      {result.triedProxies && result.triedProxies.length > 0 && (
        <Card 
          size="small" 
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <GlobalOutlined />
              <span>代理尝试记录</span>
              <Tag color="blue">{result.triedProxies.length} 个</Tag>
            </Space>
          }
        >
          <Timeline
            style={{ marginTop: 8, marginBottom: 0 }}
            items={result.triedProxies.map((proxy, index) => ({
              color: proxy.success ? 'green' : 'red',
              dot: proxy.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />,
              children: (
                <div style={{ paddingBottom: 4 }}>
                  <Space size={8} wrap>
                    <Tag color="default">优先级 {proxy.priority}</Tag>
                    <Text strong>{proxy.providerName}</Text>
                    <Text code style={{ fontSize: 12 }}>{proxy.host}</Text>
                    {proxy.success ? (
                      <Tag color="success">成功</Tag>
                    ) : (
                      <Tooltip title={proxy.failReason}>
                        <Tag color="error">{proxy.failReason?.slice(0, 15) || '失败'}</Tag>
                      </Tooltip>
                    )}
                  </Space>
                </div>
              ),
            }))}
          />
        </Card>
      )}

      {/* 重定向链路 Timeline */}
      {result.redirectChain && result.redirectChain.length > 0 && (
        <>
          <Text strong style={{ display: 'block', marginBottom: 12 }}>
            <LinkOutlined style={{ marginRight: 8 }} />
            重定向链路
          </Text>
          <Timeline
            style={{ 
              maxHeight: 300, 
              overflowY: 'auto',
              padding: '8px 0',
            }}
            items={result.redirectChain.map((step: RedirectStep, index: number) => {
              const typeInfo = getRedirectTypeInfo(step.redirectType)
              const isLast = index === result.redirectChain.length - 1
              
              return {
                color: isLast ? 'green' : 'blue',
                dot: isLast ? <CheckCircleOutlined /> : undefined,
                children: (
                  <div style={{ paddingBottom: 8 }}>
                    <Space size={8} wrap>
                      <Tag color="default">#{step.step}</Tag>
                      {step.statusCode && (
                        <Tag color={getStatusCodeColor(step.statusCode)}>
                          {step.statusCode}
                        </Tag>
                      )}
                      {step.redirectType && (
                        <Tag color={typeInfo.color}>{typeInfo.text}</Tag>
                      )}
                      <Text code style={{ fontSize: 12 }}>{step.domain}</Text>
                    </Space>
                    <div style={{ marginTop: 4 }}>
                      <Tooltip title={step.url}>
                        <Text 
                          type="secondary" 
                          style={{ 
                            fontSize: 12, 
                            wordBreak: 'break-all',
                            display: 'block',
                          }}
                        >
                          {truncateUrl(step.url, 60)}
                        </Text>
                      </Tooltip>
                    </div>
                  </div>
                ),
              }
            })}
          />
        </>
      )}
    </div>
  )
}

// ================= 联盟链接编辑弹窗 =================
interface LinkFormValues {
  url: string
  referrer: string
  enabled: boolean
}

interface LinkEditModalProps {
  visible: boolean
  campaign: CampaignItem | null
  onClose: () => void
  onSuccess: () => void
}

function LinkEditModal({ visible, campaign, onClose, onSuccess }: LinkEditModalProps) {
  const [form] = Form.useForm<LinkFormValues>()
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<AffiliateVerifyResponse | null>(null)

  const hasExistingLink = campaign?.affiliateLinkId

  useEffect(() => {
    if (visible && campaign) {
      form.setFieldsValue({
        url: campaign.affiliateLinkUrl || '',
        referrer: 'https://t.co', // 默认来路
        enabled: campaign.affiliateLinkEnabled ?? true,
      })
      // 清空之前的验证结果
      setVerifyResult(null)
    }
  }, [visible, campaign, form])

  const handleSubmit = async () => {
    if (!campaign) return

    try {
      const values = await form.validateFields()
      setLoading(true)

      if (hasExistingLink) {
        // 更新现有链接
        await putJsonPublic(`/api/v1/admin/affiliate-links/${campaign.affiliateLinkId}`, {
          url: values.url,
          enabled: values.enabled,
        })
        message.success('联盟链接已更新')
      } else {
        // 创建新链接
        await postJsonPublic('/api/v1/admin/affiliate-links', {
          userId: campaign.userId,
          campaignId: campaign.campaignId,
          url: values.url,
          enabled: values.enabled,
        })
        message.success('联盟链接已创建')
      }
      onSuccess()
      onClose()
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  // 验证联盟链接
  const handleVerifyLink = async () => {
    const url = form.getFieldValue('url')
    if (!url) {
      message.warning('请先输入联盟链接')
      return
    }

    // 校验 URL 格式
    try {
      new URL(url)
    } catch {
      message.warning('请输入有效的 URL 格式')
      return
    }

    setVerifying(true)
    setVerifyResult(null)

    try {
      // 构建请求参数
      const referrer = form.getFieldValue('referrer') || 'https://t.co'
      
      // 调用验证 API
      const result = await postJsonPublic<AffiliateVerifyResponse>('/api/affiliate-configs/verify', {
        affiliateLink: url,
        countryCode: campaign?.country || 'US', // 使用广告系列的国家代码
        targetDomain: extractDomain(campaign?.finalUrl ?? null), // 使用广告系列的目标域名
        referrer,
        maxRedirects: 10,
        campaignId: campaign?.campaignId,
        userId: campaign?.userId, // 用于获取该用户可用的代理供应商
      })

      setVerifyResult(result)

      // 根据结果显示消息
      if (result.success && result.matched) {
        message.success('链接验证通过，域名匹配')
      } else if (result.success && !result.matched) {
        message.warning('链接验证完成，但域名不匹配')
      } else {
        message.error(`链接验证失败: ${result.error || '未知错误'}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '验证请求失败'
      message.error(errorMessage)
      setVerifyResult({
        success: false,
        redirectChain: [],
        matched: false,
        totalRedirects: 0,
        error: errorMessage,
      })
    } finally {
      setVerifying(false)
    }
  }

  // 关闭弹窗时清理状态
  const handleClose = () => {
    setVerifyResult(null)
    onClose()
  }

  return (
    <Modal
      title="编辑联盟链接"
      open={visible}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={loading}
      destroyOnClose
      width={700}
      styles={{
        body: {
          maxHeight: '70vh',
          overflowY: 'auto',
        },
      }}
    >
      {campaign && (
        <div style={{ marginBottom: 16, padding: '16px', background: '#f5f5f5', borderRadius: 8 }}>
          <Row gutter={[16, 12]}>
            <Col span={24}>
              <Text type="secondary">广告系列：</Text>
              <Text strong style={{ marginLeft: 8 }}>{campaign.campaignName || campaign.campaignId}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary">国家：</Text>
              <Tag color="blue" style={{ marginLeft: 8 }}>{campaign.country || '-'}</Tag>
            </Col>
            <Col span={12}>
              <Text type="secondary">目标域名：</Text>
              <Text code style={{ marginLeft: 8 }}>{extractDomain(campaign.finalUrl)}</Text>
            </Col>
          </Row>
        </div>
      )}
      <Form form={form} layout="vertical">
        <Form.Item
          name="url"
          label="联盟链接"
          rules={[
            { required: true, message: '请输入联盟链接' },
            { type: 'url', message: '请输入有效的 URL' },
          ]}
        >
          <Input
            placeholder="https://admin.rewardoo.com/..."
            suffix={
              <Button
                type="primary"
                icon={verifying ? <LoadingOutlined /> : <SafetyCertificateOutlined />}
                onClick={handleVerifyLink}
                loading={verifying}
                size="small"
              >
                验证链接
              </Button>
            }
          />
        </Form.Item>
        <Form.Item
          name="referrer"
          label="来路 (Referer)"
          tooltip="模拟请求的来源页面，用于追踪验证"
        >
          <Input placeholder="https://t.co" />
        </Form.Item>
        <Form.Item name="enabled" label="状态" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
      </Form>

      {/* 验证中的加载状态 */}
      {verifying && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin 
            indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} 
            tip="正在验证链接，追踪重定向..."
          />
        </div>
      )}

      {/* 验证结果展示 */}
      {verifyResult && !verifying && (
        <VerifyResultDisplay result={verifyResult} />
      )}
    </Modal>
  )
}

// ================= 导入结果类型 =================
interface SheetImportResult {
  url: string
  success: boolean
  imported: number
  created: number
  updated: number
  error?: string
}

interface ImportResponse {
  totalImported: number
  totalCreated: number
  totalUpdated: number
  sheetResults: SheetImportResult[]
  errors: string[]
}

// ================= 主页面 =================
export default function LinksPage() {
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([])
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignItem | null>(null)

  // 从数据库加载广告系列列表
  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getJsonPublic<CampaignListResponse>('/api/v1/admin/campaigns')
      setCampaigns(result.campaigns)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取广告系列列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 从 Google Spreadsheet 导入广告系列
  const importFromSheets = useCallback(async () => {
    // 获取用户配置的 Spreadsheet URLs
    const spreadsheetUrls = getStoredSpreadsheetIds()
    
    if (spreadsheetUrls.length === 0) {
      message.warning('请先在「设置」页面配置 Spreadsheet URL')
      return
    }

    // 先清空列表，给用户明确的反馈
    setCampaigns([])
    setImporting(true)
    try {
      const result = await postJsonPublic<ImportResponse>('/api/v1/campaigns/import', {
        spreadsheetUrls,
      })

      // 显示结果
      if (result.totalImported > 0) {
        message.success(
          `导入成功！共 ${result.totalImported} 条（新增 ${result.totalCreated}，更新 ${result.totalUpdated}）`
        )
      } else if (result.errors.length > 0) {
        message.warning(`导入失败: ${result.errors[0]}`)
      } else {
        message.info('未找到可导入的数据')
      }

      // 刷新列表
      await loadCampaigns()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入失败，请检查网络或表格权限')
    } finally {
      setImporting(false)
    }
  }, [loadCampaigns])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  const handleEdit = (campaign: CampaignItem) => {
    setSelectedCampaign(campaign)
    setEditModalVisible(true)
  }

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      {/* 页面标题 */}
      <Card bordered={false}>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
              链接管理
            </Title>
            <Text type="secondary" style={{ fontSize: 14 }}>
              管理广告系列的联盟链接配置，支持实时同步与验证
            </Text>
          </Col>
          <Col>
            <Space>
              <Button 
                type="primary" 
                icon={<CloudDownloadOutlined />} 
                onClick={importFromSheets} 
                loading={importing}
              >
                刷新广告系列
              </Button>
              <Button 
                icon={<ReloadOutlined />} 
                onClick={loadCampaigns} 
                loading={loading}
              >
                刷新列表
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <NoApiKeyAlert />

      {/* 广告系列列表 */}
      <Card bordered={false}>
        <Table<CampaignItem>
          rowKey="id"
          loading={loading}
          dataSource={campaigns}
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{ emptyText: '暂无广告系列数据，请先运行同步脚本' }}
          columns={[
            {
              title: '序号',
              key: 'index',
              width: 70,
              align: 'center',
              render: (_, __, index) => index + 1,
            },
            {
              title: '广告系列',
              dataIndex: 'campaignName',
              key: 'campaignName',
              width: 220,
              sorter: (a, b) => (a.campaignName || '').localeCompare(b.campaignName || ''),
              ellipsis: true,
              render: (name: string | null) => (
                <Text ellipsis style={{ maxWidth: 200 }} title={name || '-'}>
                  {name || '-'}
                </Text>
              ),
            },
            {
              title: '国家',
              dataIndex: 'country',
              key: 'country',
              width: 80,
              align: 'center',
              render: (country: string | null) => country || '-',
            },
            {
              title: '状态',
              key: 'status',
              width: 90,
              align: 'center',
              render: (_, record) => {
                // 使用联盟链接的启用状态
                const enabled = record.affiliateLinkEnabled ?? (record.status === 'active')
                return (
                  <Tag 
                    color={enabled ? 'success' : 'default'}
                    style={{ margin: 0 }}
                  >
                    {enabled ? '已启用' : '已禁用'}
                  </Tag>
                )
              },
            },
            {
              title: '域名',
              key: 'domain',
              width: 160,
              render: (_, record) => {
                const domain = extractDomain(record.finalUrl)
                return domain !== '-' ? (
                  <Link 
                    href={record.finalUrl || '#'} 
                    target="_blank"
                    style={{ color: '#1890ff' }}
                  >
                    {domain}
                  </Link>
                ) : (
                  <Text type="secondary">-</Text>
                )
              },
            },
            {
              title: '来路',
              key: 'referrer',
              width: 120,
              render: () => (
                <Text type="secondary">https://t.co</Text>
              ),
            },
            {
              title: '联盟链接',
              key: 'affiliateLink',
              width: 220,
              ellipsis: true,
              render: (_, record) => {
                if (!record.affiliateLinkUrl) {
                  return <Text type="secondary">-</Text>
                }
                return (
                  <Link 
                    href={record.affiliateLinkUrl} 
                    target="_blank"
                    style={{ color: '#1890ff' }}
                    title={record.affiliateLinkUrl}
                  >
                    {truncateUrl(record.affiliateLinkUrl, 28)}
                  </Link>
                )
              },
            },
            {
              title: '操作',
              key: 'action',
              width: 100,
              align: 'center',
              render: (_, record) => (
                <Button
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => handleEdit(record)}
                  style={{ padding: 0 }}
                >
                  编辑
                </Button>
              ),
            },
          ]}
        />
      </Card>

      {/* 联盟链接编辑弹窗 */}
      <LinkEditModal
        visible={editModalVisible}
        campaign={selectedCampaign}
        onClose={() => setEditModalVisible(false)}
        onSuccess={loadCampaigns}
      />
    </Space>
  )
}
