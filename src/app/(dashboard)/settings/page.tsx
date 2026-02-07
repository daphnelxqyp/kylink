'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Card, Descriptions, Divider, Form, Input, Space, Tag, Typography, message } from 'antd'
import { CopyOutlined, LockOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { useSession } from 'next-auth/react'
import {
  clearStoredApiKey,
  CONFIG_UPDATED_EVENT,
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

export default function SettingsPage() {
  const [form] = Form.useForm()
  const [passwordForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const { data: session } = useSession()

  /**
   * 修改密码（调用 Session 认证接口，无需 API Key）
   */
  const handleChangePassword = async () => {
    try {
      const values = await passwordForm.validateFields()
      setChangingPassword(true)

      const res = await fetch('/api/v1/users/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPassword: values.oldPassword,
          newPassword: values.newPassword,
        }),
      })

      const data = await res.json()
      if (!res.ok || data?.success === false) {
        const errMsg = typeof data?.error === 'string'
          ? data.error
          : data?.error?.message || '修改失败'
        throw new Error(errMsg)
      }

      message.success('密码修改成功')
      passwordForm.resetFields()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '修改密码失败')
    } finally {
      setChangingPassword(false)
    }
  }

  useEffect(() => {
    /** 从 localStorage 加载当前用户的配置到表单 */
    const loadSettings = () => {
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
    }

    loadSettings()

    // 当用户切换时（setCurrentUser 触发），重新加载对应用户的配置
    window.addEventListener(CONFIG_UPDATED_EVENT, loadSettings)
    return () => window.removeEventListener(CONFIG_UPDATED_EVENT, loadSettings)
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

  /**
   * 通用脚本复制逻辑：获取模板 → 替换配置 → 复制到剪贴板
   * @param index - Spreadsheet 配置的索引
   * @param scriptName - 脚本模板名称 ('swap')
   * @param label - 用于提示信息的脚本显示名
   */
  const handleCopyScript = async (index: number, scriptName: 'swap', label: string) => {
    const apiKey = form.getFieldValue('apiKey')
    const configs: SpreadsheetConfig[] = form.getFieldValue('spreadsheetConfigs') || []
    const config = configs[index]

    if (!apiKey) {
      message.warning('请先填写 API Key')
      return
    }
    if (!config?.url?.trim()) {
      message.warning('请先填写 Spreadsheet URL')
      return
    }

    try {
      const res = await fetch(`/api/v1/scripts/template?name=${scriptName}`)
      const data = await res.json()
      if (!res.ok || !data.success) {
        message.error(data.error || '获取脚本模板失败')
        return
      }

      // 获取当前站点 API Base URL
      const apiBaseUrl = window.location.origin

      // 替换配置值（匹配 CONFIG 对象中的字面量字符串）
      let script = data.content as string
      script = script.replace(
        /(SPREADSHEET_URL:\s*')([^']*)(')/,
        `$1${config.url.trim()}$3`,
      )
      script = script.replace(
        /(API_KEY:\s*')([^']*)(')/,
        `$1${apiKey.trim()}$3`,
      )
      script = script.replace(
        /(API_BASE_URL:\s*')([^']*)(')/,
        `$1${apiBaseUrl}$3`,
      )

      await navigator.clipboard.writeText(script)
      message.success(`${label}已复制到剪贴板`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '复制失败，请重试')
    }
  }

  /** 复制换链脚本（campaignto1.js） */
  const handleCopySwapScript = (index: number) => handleCopyScript(index, 'swap', '换链脚本')

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      {/* ── 账户安全 ───────────────────────── */}
      <Card>
        <Title level={3} style={{ margin: 0 }}>
          账户信息
        </Title>

        <Descriptions
          column={1}
          size="small"
          style={{ marginTop: 16, maxWidth: 400 }}
        >
          <Descriptions.Item label="邮箱">
            {session?.user?.email || '加载中...'}
          </Descriptions.Item>
          <Descriptions.Item label="姓名">
            {session?.user?.name || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="角色">
            {session?.user?.role === 'ADMIN'
              ? <Tag color="blue">管理员</Tag>
              : <Tag color="green">员工</Tag>}
          </Descriptions.Item>
        </Descriptions>

        <Divider style={{ margin: '16px 0' }} />

        <Title level={5} style={{ margin: '0 0 16px' }}>修改密码</Title>

        <Form
          form={passwordForm}
          layout="vertical"
          style={{ maxWidth: 400 }}
        >
          <Form.Item
            label="当前密码"
            name="oldPassword"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请输入当前密码"
            />
          </Form.Item>

          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="至少 8 位"
            />
          </Form.Item>

          <Form.Item
            label="确认新密码"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="再次输入新密码"
            />
          </Form.Item>

          <Button
            type="primary"
            onClick={handleChangePassword}
            loading={changingPassword}
          >
            修改密码
          </Button>
        </Form>
      </Card>

      {/* ── 工作配置 ───────────────────────── */}
      <Card>
        <Title level={3} style={{ margin: 0 }}>
          工作配置
        </Title>
        <Text type="secondary">本区域信息仅保存在浏览器本地，不会上传到服务器。</Text>
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
                    <Button icon={<CopyOutlined />} onClick={() => handleCopySwapScript(index)}>复制换链脚本</Button>
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
                {fields.map((field) => (
                  <Space key={field.key} style={{ width: '100%' }} align="start">
                    {/* 联盟简称输入框 */}
                    <Form.Item
                      name={[field.name, 'name']}
                      style={{ width: 160, marginBottom: 0 }}
                    >
                      <Input placeholder="联盟简称" />
                    </Form.Item>
                    {/* 联盟 API 密钥输入框 */}
                    <Form.Item
                      name={[field.name, 'apiKey']}
                      style={{ flex: 1, marginBottom: 0, minWidth: 300 }}
                    >
                      <Input.Password placeholder="联盟 API 密钥" />
                    </Form.Item>
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
                  onClick={() => add({ name: '', apiKey: '' })}
                  style={{ width: '100%' }}
                >
                  添加联盟链接 API 配置
                </Button>
              </Space>
            )}
          </Form.List>

          <Space style={{ marginTop: 24 }}>
            <Button type="primary" onClick={handleSave} loading={saving}>
              保存配置
            </Button>
            <Button onClick={handleCopyApiKey}>复制 API Key</Button>
            <Button onClick={handleTestConnection} loading={saving}>
              测试连接
            </Button>
            <Button onClick={handleClear}>清空本地配置</Button>
          </Space>
        </Form>
      </Card>

    </Space>
  )
}

