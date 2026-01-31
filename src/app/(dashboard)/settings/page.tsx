'use client'

import { useEffect, useState, useCallback } from 'react'
import { Alert, Button, Card, Form, Input, Progress, Space, Typography, message } from 'antd'
import { MinusOutlined, PlusOutlined, SyncOutlined, CheckCircleOutlined } from '@ant-design/icons'
import {
  clearStoredApiKey,
  getJson,
  getStoredApiKey,
  isValidApiKey,
  setStoredApiKey,
  getStoredSpreadsheetConfigs,
  clearStoredSpreadsheetConfigs,
  setStoredSpreadsheetConfigs,
  SpreadsheetConfig,
  getStoredAffiliateApiConfigs,
  setStoredAffiliateApiConfigs,
  clearStoredAffiliateApiConfigs,
  AffiliateApiConfig,
} from '@/lib/api-client'

const { Title, Text } = Typography

/** 同步进度状态 */
interface SyncProgress {
  stage: 'init' | 'fetching' | 'saving' | 'done' | 'error'
  current: number
  total: number
  message: string
  networkName?: string
}

/** 每个联盟的同步状态 */
interface AffiliateSyncState {
  syncing: boolean
  progress: SyncProgress | null
}

export default function SettingsPage() {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  
  // 联盟同步状态（按索引存储）
  const [affiliateSyncStates, setAffiliateSyncStates] = useState<Record<number, AffiliateSyncState>>({})
  
  // 是否有任何同步正在进行
  const isSyncing = Object.values(affiliateSyncStates).some(state => state.syncing)

  useEffect(() => {
    const apiKey = getStoredApiKey() || ''
    const spreadsheetConfigs = getStoredSpreadsheetConfigs()
    const affiliateApiConfigs = getStoredAffiliateApiConfigs()
    // 表单使用对象数组
    const sheetConfigs = spreadsheetConfigs.length ? spreadsheetConfigs : [{ mccName: '', url: '' }]
    const affConfigs = affiliateApiConfigs.length ? affiliateApiConfigs : [{ name: '', apiKey: '' }]
    form.setFieldsValue({
      apiKey,
      spreadsheetConfigs: sheetConfigs,
      affiliateApiConfigs: affConfigs,
    })
  }, [form])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      setStoredApiKey(values.apiKey.trim())
      
      // 处理 spreadsheet 配置，去重（根据 URL）并过滤空值
      const configsMap = new Map<string, SpreadsheetConfig>()
      ;(values.spreadsheetConfigs || []).forEach((config: SpreadsheetConfig) => {
        const url = (config.url || '').trim()
        if (url && !configsMap.has(url)) {
          configsMap.set(url, {
            mccName: (config.mccName || '').trim(),
            url,
          })
        }
      })
      const normalizedSheetConfigs = Array.from(configsMap.values())
      setStoredSpreadsheetConfigs(normalizedSheetConfigs)
      
      // 处理联盟链接 API 配置，去重（根据名称）并过滤空值
      const affConfigsMap = new Map<string, AffiliateApiConfig>()
      ;(values.affiliateApiConfigs || []).forEach((config: AffiliateApiConfig) => {
        const name = (config.name || '').trim()
        const apiKey = (config.apiKey || '').trim()
        if (name && apiKey && !affConfigsMap.has(name)) {
          affConfigsMap.set(name, { name, apiKey })
        }
      })
      const normalizedAffConfigs = Array.from(affConfigsMap.values())
      setStoredAffiliateApiConfigs(normalizedAffConfigs)
      
      form.setFieldsValue({
        spreadsheetConfigs: normalizedSheetConfigs.length ? normalizedSheetConfigs : [{ mccName: '', url: '' }],
        affiliateApiConfigs: normalizedAffConfigs.length ? normalizedAffConfigs : [{ name: '', apiKey: '' }],
      })

      message.success('配置已保存')
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleClear = () => {
    clearStoredApiKey()
    clearStoredSpreadsheetConfigs()
    clearStoredAffiliateApiConfigs()
    form.resetFields()
    // 重置后保留一个空配置行
    form.setFieldsValue({
      spreadsheetConfigs: [{ mccName: '', url: '' }],
      affiliateApiConfigs: [{ name: '', apiKey: '' }],
    })
    message.success('已清空本地配置')
  }

  const handleCopyApiKey = async () => {
    const apiKey = form.getFieldValue('apiKey')
    if (!apiKey) {
      message.warning('请先填写 API Key')
      return
    }
    try {
      await navigator.clipboard.writeText(apiKey)
      message.success('API Key 已复制')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  const handleTestConnection = async () => {
    const apiKey = form.getFieldValue('apiKey')
    if (!apiKey || !isValidApiKey(apiKey)) {
      message.warning('请先填写有效的 API Key')
      return
    }
    setSaving(true)
    try {
      await getJson('/api/v1/jobs')
      message.success('连接成功，API Key 可用')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '连接失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCopySyncScript = (index: number) => {
    message.info(`已选择第 ${index + 1} 个 Spreadsheet URL：复制同步脚本功能待接入`)
  }

  const handleCopySwapScript = (index: number) => {
    message.info(`已选择第 ${index + 1} 个 Spreadsheet URL：复制换链脚本功能待接入`)
  }

  /**
   * 更新联盟链接 - 调用同步 API 并实时显示进度
   */
  const handleUpdateAffiliateLinks = useCallback(async (index: number) => {
    const configs = form.getFieldValue('affiliateApiConfigs') || []
    const config = configs[index]
    
    if (!config?.name || !config?.apiKey) {
      message.warning('请先填写联盟简称和 API 密钥')
      return
    }

    // 获取系统 API Key
    const systemApiKey = form.getFieldValue('apiKey')
    if (!systemApiKey || !isValidApiKey(systemApiKey)) {
      message.warning('请先填写有效的系统 API Key')
      return
    }

    // 检查是否正在同步
    if (affiliateSyncStates[index]?.syncing) {
      message.warning('该联盟正在同步中，请稍候...')
      return
    }

    // 设置同步状态
    setAffiliateSyncStates(prev => ({
      ...prev,
      [index]: {
        syncing: true,
        progress: {
          stage: 'init',
          current: 0,
          total: 0,
          message: '正在初始化...',
          networkName: config.name,
        },
      },
    }))

    try {
      // 调用同步 API（SSE 流）
      const response = await fetch('/api/v1/affiliate-networks/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${systemApiKey}`,
        },
        body: JSON.stringify({
          networkShortName: config.name,
          apiKey: config.apiKey,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '请求失败' }))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      // 读取 SSE 流
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        
        // 解析 SSE 数据
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const progress: SyncProgress = JSON.parse(line.slice(6))
              setAffiliateSyncStates(prev => ({
                ...prev,
                [index]: {
                  syncing: progress.stage !== 'done' && progress.stage !== 'error',
                  progress,
                },
              }))

              // 同步完成或失败时显示消息
              if (progress.stage === 'done') {
                message.success(progress.message)
              } else if (progress.stage === 'error') {
                message.error(progress.message)
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '同步失败'
      message.error(errorMessage)
      setAffiliateSyncStates(prev => ({
        ...prev,
        [index]: {
          syncing: false,
          progress: {
            stage: 'error',
            current: 0,
            total: 0,
            message: errorMessage,
            networkName: config.name,
          },
        },
      }))
    }
  }, [form, affiliateSyncStates])

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card>
        <Title level={3} style={{ margin: 0 }}>
          基础配置
        </Title>
        <Text type="secondary">本页信息仅保存在浏览器本地，不会上传到服务器。</Text>
      </Card>

      <Alert
        type="info"
        showIcon
        message="安全提示"
        description="请不要在公共电脑保存 API Key；如有泄露风险，建议在后台重置密钥。"
      />

      <Card>
        <Form form={form} layout="vertical">
          <Form.Item
            label="API Key"
            name="apiKey"
            rules={[
              { required: true, message: '请输入 API Key' },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve()
                  return isValidApiKey(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('API Key 格式不正确'))
                },
              },
            ]}
          >
            <Input.Password placeholder="ky_live_ 或 ky_test_ 开头的 40 位密钥" />
          </Form.Item>

          <Form.List name="spreadsheetConfigs">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Text type="secondary">Spreadsheet 配置（可添加多个）</Text>
                {fields.map((field, index) => (
                  <Space key={field.key} style={{ width: '100%' }} align="start">
                    {/* MCC 名称输入框 */}
                    <Form.Item
                      name={[field.name, 'mccName']}
                      style={{ width: 160, marginBottom: 0 }}
                    >
                      <Input placeholder="MCC 名称" />
                    </Form.Item>
                    {/* Spreadsheet URL 输入框 */}
                    <Form.Item
                      name={[field.name, 'url']}
                      rules={[
                        {
                          validator: (_, value) => {
                            if (!value || String(value).trim()) {
                              return Promise.resolve()
                            }
                            return Promise.reject(new Error('请输入有效的 Spreadsheet URL'))
                          },
                        },
                      ]}
                      style={{ flex: 1, marginBottom: 0, minWidth: 300 }}
                    >
                      <Input placeholder="用于脚本写入的 Google 表格 URL" />
                    </Form.Item>
                    <Space size={6}>
                      <Button onClick={() => handleCopySyncScript(index)}>复制同步脚本</Button>
                      <Button onClick={() => handleCopySwapScript(index)}>复制换链脚本</Button>
                    </Space>
                    <Button
                      icon={<MinusOutlined />}
                      onClick={() => remove(field.name)}
                      disabled={fields.length === 1}
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ mccName: '', url: '' })}
                  style={{ width: '100%' }}
                >
                  添加 Spreadsheet 配置
                </Button>
              </Space>
            )}
          </Form.List>

          {/* 联盟链接 API 配置 */}
          <Form.List name="affiliateApiConfigs">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%', marginTop: 24 }} size={8}>
                <div>
                  <Text type="secondary">联盟链接 API 配置（可添加多个）</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    支持的联盟：<Text code>RW</Text> (Rewardoo)、<Text code>LH</Text> (LinkHaitao)、<Text code>PM</Text> (Partnermatic)、<Text code>LB</Text> (Linkbux)、<Text code>CG</Text> (CollabGlow)、<Text code>CF</Text> (CreatorFlare)、<Text code>BSH</Text> (BrandSparkHub)
                    <br />
                    联盟简称格式：RW1, LH1, PM1, LB1, CG1, CF1, BSH1...（前缀标识联盟类型，数字区分多个账号）
                  </Text>
                </div>
                {fields.map((field, index) => {
                  const syncState = affiliateSyncStates[index]
                  const isSyncingThis = syncState?.syncing || false
                  const progress = syncState?.progress
                  
                  return (
                    <div key={field.key} style={{ width: '100%' }}>
                      <Space style={{ width: '100%' }} align="start">
                        {/* 联盟简称输入框 */}
                        <Form.Item
                          name={[field.name, 'name']}
                          style={{ width: 160, marginBottom: 0 }}
                        >
                          <Input placeholder="联盟简称" disabled={isSyncingThis} />
                        </Form.Item>
                        {/* 联盟 API 密钥输入框 */}
                        <Form.Item
                          name={[field.name, 'apiKey']}
                          style={{ flex: 1, marginBottom: 0, minWidth: 300 }}
                        >
                          <Input.Password placeholder="联盟 API 密钥" disabled={isSyncingThis} />
                        </Form.Item>
                        <Button 
                          onClick={() => handleUpdateAffiliateLinks(index)}
                          loading={isSyncingThis}
                          icon={progress?.stage === 'done' ? <CheckCircleOutlined /> : <SyncOutlined spin={isSyncingThis} />}
                          type={progress?.stage === 'done' ? 'default' : 'primary'}
                          disabled={isSyncing && !isSyncingThis}
                        >
                          {isSyncingThis ? '同步中...' : (progress?.stage === 'done' ? '已完成' : '更新联盟链接')}
                        </Button>
                        <Button
                          icon={<MinusOutlined />}
                          onClick={() => remove(field.name)}
                          disabled={fields.length === 1 || isSyncingThis}
                        />
                      </Space>
                      
                      {/* 同步进度条 */}
                      {progress && progress.stage !== 'error' && (
                        <div style={{ marginTop: 8, paddingLeft: 160 + 8 }}>
                          <Progress 
                            percent={progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}
                            status={progress.stage === 'done' ? 'success' : 'active'}
                            size="small"
                            format={() => progress.message}
                            style={{ maxWidth: 500 }}
                          />
                        </div>
                      )}
                      
                      {/* 错误提示 */}
                      {progress?.stage === 'error' && (
                        <div style={{ marginTop: 8, paddingLeft: 160 + 8 }}>
                          <Text type="danger">{progress.message}</Text>
                        </div>
                      )}
                    </div>
                  )
                })}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ name: '', apiKey: '' })}
                  style={{ width: '100%' }}
                  disabled={isSyncing}
                >
                  添加联盟链接 API 配置
                </Button>
              </Space>
            )}
          </Form.List>

          <Space style={{ marginTop: 24 }}>
            <Button type="primary" onClick={handleSave} loading={saving} disabled={isSyncing}>
              保存配置
            </Button>
            <Button onClick={handleCopyApiKey} disabled={isSyncing}>复制 API Key</Button>
            <Button onClick={handleTestConnection} loading={saving} disabled={isSyncing}>
              测试连接
            </Button>
            <Button onClick={handleClear} disabled={isSyncing}>清空本地配置</Button>
          </Space>
        </Form>
      </Card>

    </Space>
  )
}

