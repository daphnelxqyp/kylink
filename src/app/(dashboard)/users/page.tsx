'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { deleteJsonPublic, getJsonPublic, postJsonPublic, putJsonPublic } from '@/lib/api-client'
import type { AdminUserItem, AdminUserListResponse, UserRole, UserStatus } from '@/types/dashboard'

const { Title, Text } = Typography

interface CreateUserResponse {
  success: boolean
  user: AdminUserItem
  apiKey: string
  mode: 'created'
}

interface UpdateUserResponse {
  success: boolean
  user: AdminUserItem
}

interface ResetKeyResponse {
  success: boolean
  user: AdminUserItem
  apiKey: string
  mode: 'reset'
}

function formatDate(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

export default function UsersPage() {
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null)
  const [userModalOpen, setUserModalOpen] = useState(false)

  const [form] = Form.useForm()

  const loadUsers = async () => {
    setLoading(true)
    try {
      const result = await getJsonPublic<AdminUserListResponse>('/api/v1/admin/users')
      setUsers(result.users || [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setUsers([])
  }, [])

  const openCreateModal = () => {
    setEditingUser(null)
    form.resetFields()
    form.setFieldsValue({
      status: 'active',
      role: 'USER',
    })
    setUserModalOpen(true)
  }

  const openEditModal = (user: AdminUserItem) => {
    setEditingUser(user)
    form.resetFields()
    form.setFieldsValue({
      email: user.email || '',
      name: user.name || '',
      status: user.status,
      role: user.role || 'USER',
      password: '', // 编辑时清空密码字段
    })
    setUserModalOpen(true)
  }

  const handleSaveUser = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      if (editingUser) {
        const result = await putJsonPublic<UpdateUserResponse>(
          `/api/v1/admin/users/${editingUser.id}`,
          {
            email: values.email.trim(),
            name: values.name?.trim() || undefined,
            status: values.status,
            role: values.role,
            // 如果填写了新密码，则更新密码
            password: values.password?.trim() || undefined,
          }
        )
        setUsers(prev => prev.map(user => (user.id === result.user.id ? result.user : user)))
        message.success('用户信息已更新')
        setUserModalOpen(false)
        return
      }

      // 创建用户，API Key 由后端自动生成
      const result = await postJsonPublic<CreateUserResponse>(
        '/api/v1/admin/users',
        {
          email: values.email.trim(),
          name: values.name?.trim() || undefined,
          status: values.status,
          role: values.role,
          password: values.password,
        }
      )
      setUsers(prev => [result.user, ...prev])

      // 自动复制 API Key 到剪贴板
      try {
        await navigator.clipboard.writeText(result.apiKey)
        message.success('用户已创建，API 密钥已复制到剪贴板，只须粘贴过去即可', 5)
      } catch {
        // 如果复制失败，显示 API Key 让用户手动复制
        message.warning('用户已创建，但自动复制失败，请手动复制 API Key')
        Modal.info({
          title: 'API 密钥',
          content: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input readOnly value={result.apiKey} />
              <Text type="secondary">请手动复制上方的 API 密钥</Text>
            </Space>
          ),
        })
      }
      setUserModalOpen(false)
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = (user: AdminUserItem) => {
    Modal.confirm({
      title: '确认删除用户？',
      content: `删除后将无法使用该用户的 API Key：${user.email || user.id}`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true)
        try {
          await deleteJsonPublic(`/api/v1/admin/users/${user.id}`)
          setUsers(prev => prev.filter(item => item.id !== user.id))
          message.success('用户已删除')
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败')
        } finally {
          setLoading(false)
        }
      },
    })
  }

  // 重置 API Key（直接确认后执行）
  const handleResetApiKey = (user: AdminUserItem) => {
    Modal.confirm({
      title: '重置 API Key',
      content: `重置后旧 Key 将失效，确认重置 ${user.email || user.id} 的 API Key？`,
      okText: '确认重置',
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true)
        try {
          const result = await postJsonPublic<ResetKeyResponse>(
            `/api/v1/admin/users/${user.id}/api-key`,
            {}
          )
          setUsers(prev => prev.map(u => (u.id === result.user.id ? result.user : u)))

          // 自动复制新 API Key 到剪贴板
          try {
            await navigator.clipboard.writeText(result.apiKey)
            message.success('API Key 已重置，新密钥已复制到剪贴板，只须粘贴过去即可', 5)
          } catch {
            // 如果复制失败，显示 API Key 让用户手动复制
            message.warning('API Key 已重置，但自动复制失败，请手动复制')
            Modal.info({
              title: '新 API 密钥',
              content: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input readOnly value={result.apiKey} />
                  <Text type="secondary">请手动复制上方的 API 密钥</Text>
                </Space>
              ),
            })
          }
        } catch (error) {
          message.error(error instanceof Error ? error.message : '重置失败')
        } finally {
          setLoading(false)
        }
      },
    })
  }

  const columns = [
    {
      title: '邮箱',
      dataIndex: 'email',
      render: (value: string | null) => value || '-',
    },
    {
      title: '名称',
      dataIndex: 'name',
      render: (value: string | null) => value || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: UserStatus) =>
        value === 'active' ? <Tag color="green">启用</Tag> : <Tag color="red">暂停</Tag>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      render: (value: UserRole) =>
        value === 'ADMIN' ? <Tag color="blue">管理员</Tag> : <Tag>普通用户</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      render: (value: string) => formatDate(value),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: AdminUserItem) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Button size="small" icon={<KeyOutlined />} onClick={() => handleResetApiKey(record)}>
            重置 Key
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteUser(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card>
        <Title level={3} style={{ margin: 0 }}>
          用户管理
        </Title>
        <Text type="secondary">创建、编辑、停用用户，并为用户重置 API Key。</Text>
      </Card>

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadUsers} loading={loading}>
              刷新列表
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              创建用户
            </Button>
          </Space>
        </Space>
      </Card>

      <Card>
        <Table<AdminUserItem>
          rowKey="id"
          loading={loading}
          dataSource={users}
          columns={columns}
          locale={{ emptyText: '暂无用户数据' }}
        />
      </Card>

      <Modal
        title={editingUser ? '编辑用户' : '创建用户'}
        open={userModalOpen}
        onCancel={() => setUserModalOpen(false)}
        onOk={handleSaveUser}
        confirmLoading={loading}
        okText={editingUser ? '保存' : '创建'}
      >
        <Form form={form} layout="vertical" initialValues={{ status: 'active' }}>
          <Form.Item
            label="邮箱"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve()
                  return value.includes('@')
                    ? Promise.resolve()
                    : Promise.reject(new Error('邮箱格式不正确'))
                },
              },
            ]}
          >
            <Input placeholder="user@kyads.com" />
          </Form.Item>
          <Form.Item label="名称" name="name">
            <Input placeholder="可选" />
          </Form.Item>
            <Form.Item
            label={editingUser ? '新密码' : '密码'}
              name="password"
              rules={[
              { required: !editingUser, message: '请输入密码' },
                { min: 6, message: '密码至少需要 6 位' },
              ]}
            extra={editingUser ? '留空表示不修改密码' : undefined}
          >
            <Input.Password placeholder={editingUser ? '留空表示不修改' : '至少 6 位'} />
              </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              options={[
                { label: '启用', value: 'active' },
                { label: '暂停', value: 'suspended' },
              ]}
            />
          </Form.Item>
          <Form.Item label="角色" name="role">
            <Select
              options={[
                { label: '普通用户', value: 'USER' },
                { label: '管理员', value: 'ADMIN' },
              ]}
            />
          </Form.Item>
        </Form>

      </Modal>

    </Space>
  )
}

