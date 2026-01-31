'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Col,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { deleteJsonPublic, getJsonPublic, postJsonPublic, putJsonPublic } from '@/lib/api-client'
import type {
  AdminProxyProviderItem,
  AdminProxyProviderListResponse,
  AdminUserItem,
  AdminUserListResponse,
} from '@/types/dashboard'

const { Title, Text } = Typography

interface ProxyProviderResponse {
  success: boolean
  provider: AdminProxyProviderItem
}

interface ProxyProviderTestResponse {
  success: boolean
  ok: boolean
  message: string
  details?: {
    host?: string
    port?: number
    resolvedIp?: string
    latencyMs?: number
    step?: string
  }
}

function formatDate(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

export default function ProxyProvidersPage() {
  const [loading, setLoading] = useState(false)
  const [providers, setProviders] = useState<AdminProxyProviderItem[]>([])
  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [editingProvider, setEditingProvider] = useState<AdminProxyProviderItem | null>(null)
  const [providerModalOpen, setProviderModalOpen] = useState(false)
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [assignTarget, setAssignTarget] = useState<AdminProxyProviderItem | null>(null)

  const [form] = Form.useForm()
  const [assignForm] = Form.useForm()

  const refreshAll = async () => {
    setLoading(true)
    try {
      const [providersResult, usersResult] = await Promise.all([
        getJsonPublic<AdminProxyProviderListResponse>('/api/v1/admin/proxy-providers'),
        getJsonPublic<AdminUserListResponse>('/api/v1/admin/users'),
      ])
      setProviders(providersResult.providers || [])
      setUsers(usersResult.users || [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取代理供应商列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setProviders([])
    setUsers([])
  }, [])

  const openCreateModal = () => {
    setEditingProvider(null)
    form.resetFields()
    form.setFieldsValue({
      priority: 0,
      port: 8080,
      enabled: true,
    })
    setProviderModalOpen(true)
  }

  const openEditModal = (provider: AdminProxyProviderItem) => {
    setEditingProvider(provider)
    form.setFieldsValue({
      name: provider.name,
      priority: provider.priority,
      host: provider.host,
      port: provider.port,
      usernameTemplate: provider.usernameTemplate || '',
      password: '',
      enabled: provider.enabled,
    })
    setProviderModalOpen(true)
  }

  const handleSaveProvider = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        priority: Number(values.priority) || 0,
        host: values.host.trim(),
        port: Number(values.port),
        usernameTemplate: values.usernameTemplate.trim(),
        enabled: Boolean(values.enabled),
      }

      if (values.password?.trim()) {
        payload.password = values.password.trim()
      }

      if (editingProvider) {
        const result = await putJsonPublic<ProxyProviderResponse>(
          `/api/v1/admin/proxy-providers/${editingProvider.id}`,
          payload
        )
        setProviders(prev => prev.map(item => (item.id === result.provider.id ? result.provider : item)))
        message.success('代理供应商已更新')
        setProviderModalOpen(false)
        return
      }

      const result = await postJsonPublic<ProxyProviderResponse>(
        '/api/v1/admin/proxy-providers',
        payload
      )
      setProviders(prev => [result.provider, ...prev])
      message.success('代理供应商已创建')
      setProviderModalOpen(false)
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteProvider = (provider: AdminProxyProviderItem) => {
    Modal.confirm({
      title: '确认删除代理供应商？',
      content: `删除后将无法使用该代理供应商：${provider.name}`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true)
        try {
          await deleteJsonPublic(`/api/v1/admin/proxy-providers/${provider.id}`)
          setProviders(prev => prev.filter(item => item.id !== provider.id))
          message.success('代理供应商已删除')
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败')
        } finally {
          setLoading(false)
        }
      },
    })
  }

  const openAssignModal = async (provider: AdminProxyProviderItem) => {
    if (users.length === 0) {
      await refreshAll()
    }

    setAssignTarget(provider)
    // 使用 assignedUsers 数组，如果没有则回退到 assignedUserId
    const userIds = provider.assignedUsers?.map(u => u.id) || 
      (provider.assignedUserId ? [provider.assignedUserId] : [])
    assignForm.setFieldsValue({
      userIds,
    })
    setAssignModalOpen(true)
  }

  const handleAssignProvider = async () => {
    if (!assignTarget) {
      message.warning('请选择需要分配的代理商')
      return
    }
    try {
      const values = await assignForm.validateFields()
      setLoading(true)
      // 发送 userIds 数组
      const result = await postJsonPublic<ProxyProviderResponse>(
        `/api/v1/admin/proxy-providers/${assignTarget.id}/assign`,
        { userIds: values.userIds || [] }
      )
      setProviders(prev => prev.map(item => (item.id === result.provider.id ? result.provider : item)))
      message.success('分配已更新')
      setAssignModalOpen(false)
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleTestProvider = async (provider: AdminProxyProviderItem) => {
    setLoading(true)
    try {
      const result = await postJsonPublic<ProxyProviderTestResponse>(
        `/api/v1/admin/proxy-providers/${provider.id}/test`,
        {}
      )
      Modal[result.ok ? 'success' : 'warning']({
        title: result.ok ? '✅ 测试成功' : '⚠️ 连接失败',
        content: (
          <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 12 }}>
            <Text strong>供应商：{provider.name}</Text>
            <Text type={result.ok ? 'success' : 'danger'}>{result.message}</Text>
            {result.details && (
              <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, marginTop: 8 }}>
                <Space direction="vertical" size={4}>
                  <Text type="secondary">地址：{result.details.host}:{result.details.port}</Text>
                  {result.details.resolvedIp && (
                    <Text type="secondary">解析 IP：{result.details.resolvedIp}</Text>
                  )}
                  {result.details.latencyMs !== undefined && (
                    <Text type="secondary">延迟：{result.details.latencyMs}ms</Text>
                  )}
                </Space>
              </div>
            )}
            {!result.ok && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message="提示"
                description="此测试仅验证端口连通性。如果端口可达但代理仍不工作，请检查用户名模板和密码是否正确配置。"
              />
            )}
          </Space>
        ),
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试失败')
    } finally {
      setLoading(false)
    }
  }

  const columns = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
      },
      {
        title: '优先级',
        dataIndex: 'priority',
      },
      {
        title: '地址',
        dataIndex: 'host',
      },
      {
        title: '端口',
        dataIndex: 'port',
      },
      {
        title: '状态',
        dataIndex: 'enabled',
        render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
      },
      {
        title: '分配用户',
        dataIndex: 'assignedUsers',
        render: (_: unknown, record: AdminProxyProviderItem) => {
          // 优先使用 assignedUsers，回退到 assignedUser
          const assignedUsers = record.assignedUsers || (record.assignedUser ? [record.assignedUser] : [])
          if (assignedUsers.length === 0) return '-'
          return (
            <Space size={4} wrap>
              {assignedUsers.map(user => (
                <Tag key={user.id} color="blue">
                  {user.name || user.email || user.id.slice(0, 8)}
                </Tag>
              ))}
            </Space>
          )
        },
      },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        render: (value: string) => formatDate(value),
      },
      {
        title: '操作',
        key: 'action',
        render: (_: unknown, record: AdminProxyProviderItem) => (
          <Space>
            <Button size="small" icon={<ExperimentOutlined />} onClick={() => handleTestProvider(record)}>
              测试
            </Button>
            <Button size="small" icon={<TeamOutlined />} onClick={() => openAssignModal(record)}>
              分配
            </Button>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
              编辑
            </Button>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteProvider(record)}>
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [users]
  )

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Title level={3} style={{ margin: 0 }}>
          代理管理
        </Title>
        <Text type="secondary">配置代理供应商，并分配给指定用户。</Text>
      </Card>

      <Alert
        type="info"
        showIcon
        message="安全提示"
        description="代理密码仅用于保存配置，后续如需调整请重新编辑。"
      />

      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshAll} loading={loading}>
              刷新列表
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新增代理商
            </Button>
          </Space>
        </Space>
      </Card>

      <Card>
        <Table<AdminProxyProviderItem>
          rowKey="id"
          loading={loading}
          dataSource={providers}
          columns={columns}
          locale={{ emptyText: '暂无代理供应商' }}
        />
      </Card>

      <Modal
        title={editingProvider ? '编辑代理商' : '新增代理商'}
        open={providerModalOpen}
        onCancel={() => setProviderModalOpen(false)}
        onOk={handleSaveProvider}
        confirmLoading={loading}
        okText={editingProvider ? '保存' : '创建'}
      >
        <Form
          form={form}
          layout="vertical"
          className="compact-form"
          initialValues={{ priority: 0, port: 8080, enabled: true }}
        >
          <Row gutter={[16, 8]}>
            <Col xs={24} md={12}>
          <Form.Item
            label="供应商名称"
            name="name"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="例如：Brightdata, Oxylabs" />
          </Form.Item>
            </Col>
            <Col xs={24} md={12}>
          <Form.Item label="优先级" name="priority">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
            </Col>
            <Col xs={24} md={12}>
          <Form.Item
            label="代理地址"
            name="host"
            rules={[{ required: true, message: '请输入代理地址' }]}
          >
            <Input placeholder="proxy.example.com" />
          </Form.Item>
            </Col>
            <Col xs={24} md={12}>
          <Form.Item
            label="端口"
            name="port"
            rules={[{ required: true, message: '请输入端口号' }]}
          >
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
            </Col>
            <Col xs={24} md={12}>
          <Form.Item
            label="用户名称模板"
            name="usernameTemplate"
            rules={[{ required: true, message: '请输入用户名称模板' }]}
          >
            <Input placeholder="例如：user-region-{country}-session-{session:8}" />
          </Form.Item>
            </Col>
            <Col xs={24} md={12}>
          <Form.Item
            label="认证密码"
            name="password"
            rules={
              editingProvider
                ? []
                : [{ required: true, message: '请输入认证密码' }]
            }
          >
            <Input.Password placeholder={editingProvider ? '留空则不修改' : '请输入代理认证密码'} />
          </Form.Item>
            </Col>
            <Col xs={24} md={12}>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title="分配代理商"
        open={assignModalOpen}
        onCancel={() => setAssignModalOpen(false)}
        onOk={handleAssignProvider}
        confirmLoading={loading}
        okText="确认分配"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>选择需要分配的用户（可多选），留空表示取消分配。</Text>
          <Form form={assignForm} layout="vertical" className="compact-form">
            <Form.Item label="分配给用户" name="userIds">
              <Select
                mode="multiple"
                placeholder="请选择用户（可多选）"
                allowClear
                showSearch
                optionFilterProp="label"
                options={users.map(user => ({
                  label: user.name || user.email || user.id,
                  value: user.id,
                }))}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </Space>
  )
}

