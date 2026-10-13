import { toast } from '@/features/toast/toastStore'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Register the service worker in production builds. In development any
 * worker left over from a preview build is removed, so the dev server is
 * never shadowed by a cached app.
 */
export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  // The app (Electron) has its files on disk already.
  if ((window as unknown as { groovelab?: unknown }).groovelab) return
  if (!import.meta.env.PROD) {
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()))
    return
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const next = reg.installing
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              toast({ title: '新版本已下载', description: '关闭所有律动工坊窗口后重新打开即可使用新版本。', variant: 'info' })
            }
            if (next.state === 'installed' && !navigator.serviceWorker.controller) {
              toast({ title: '已可离线使用', description: '训练、课程和作曲都能在断网时使用；AI 和采样钢琴需要联网。', variant: 'success' })
            }
          })
        })
      })
      .catch((err: unknown) => logger.warn('Service worker registration failed', { error: err instanceof Error ? err.message : String(err) }))
  })
}
