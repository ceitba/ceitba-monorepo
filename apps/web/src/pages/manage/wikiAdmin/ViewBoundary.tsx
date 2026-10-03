import { Component, type ErrorInfo, type ReactNode } from 'react'
import ViewBoundaryFallback from './ViewBoundaryFallback'

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
      return <ViewBoundaryFallback error={this.state.error} onRetry={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))} />
    }
    // Remount the subtree on retry so it refetches.
    return <div key={this.state.attempt}>{this.props.children}</div>
  }
}
