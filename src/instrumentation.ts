/**
 * Next.js Instrumentation Hook
 * 在服务启动时初始化定时任务
 *
 * 文档：https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 只在 Node.js 运行时执行（不在 Edge Runtime）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeDefaultJobs, startInternalScheduler, stopInternalScheduler } =
      await import('./lib/cron-scheduler')

    const enableAutoCron = process.env.ENABLE_AUTO_CRON === 'true'

    if (enableAutoCron) {
      // 初始化并启动定时任务
      console.log('[Instrumentation] Initializing auto cron scheduler...')
      initializeDefaultJobs()
      startInternalScheduler()
      console.log('[Instrumentation] Auto cron scheduler started')

      // 优雅关闭处理
      const shutdown = () => {
        console.log('[Instrumentation] Shutting down cron scheduler...')
        stopInternalScheduler()
        process.exit(0)
      }

      process.on('SIGTERM', shutdown)
      process.on('SIGINT', shutdown)
    } else {
      console.log('[Instrumentation] Auto cron disabled (ENABLE_AUTO_CRON != true)')
    }
  }
}
