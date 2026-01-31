import { Suspense } from 'react'
import AppLayout from '@/components/app-layout'
import UnauthorizedAlert from '@/components/unauthorized-alert'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <UnauthorizedAlert />
      </Suspense>
      {children}
    </AppLayout>
  )
}

