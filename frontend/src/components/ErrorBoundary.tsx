import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  /** Changing this clears the error, for example when the team opens another module. */
  resetKey?: unknown
  fallback: (error: Error, reset: () => void) => ReactNode
  children: ReactNode
}

/** Keeps a failure inside one part of the screen, so the rest keeps working and no work is lost. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    return error ? this.props.fallback(error, () => this.setState({ error: null })) : this.props.children
  }
}
