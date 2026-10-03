import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Per-sub-view error boundary: a response with an unexpected shape shows an
// inline error (with retry) instead of blanking the whole Wiki IA tab.
export default class ViewBoundary extends Component<{ children: ReactNode }, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Wiki IA view crashed', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return <Fallback error={this.state.error} onRetry={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))} />
    }
    // Remount the subtree on retry so it refetches.
    return <div key={this.state.attempt}>{this.props.children}</div>
  }
}

function Fallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col gap-2 px-4 py-4 rounded-card border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 font-body text-body-sm text-red-700 dark:text-red-300">
      <p className="font-semibold">{t('manage.wikiAi.crashed')}</p>
      <code className="font-mono text-[0.75rem] break-words opacity-80">{error.message}</code>
      <button type="button" onClick={onRetry} className="self-start font-mono text-label uppercase tracking-widest underline">{t('errors.retry')}</button>
    </div>
  )
}
