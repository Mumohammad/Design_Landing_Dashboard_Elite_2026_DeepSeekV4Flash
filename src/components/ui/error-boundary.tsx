"use client"

import * as React from "react"
import { AlertTriangle, RefreshCcw, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })
    this.props.onError?.(error, errorInfo)
    console.error("[ErrorBoundary]", error, errorInfo)
  }

  retry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const Fallback = this.props.fallback
        return <Fallback error={this.state.error!} retry={this.retry} />
      }
      return <DefaultErrorFallback error={this.state.error!} retry={this.retry} />
    }
    return this.props.children
  }
}

function DefaultErrorFallback({ error, retry }: { error: Error; retry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-[400px] items-center justify-center p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border/50 bg-card/80 p-8 text-center backdrop-blur-sm shadow-xl">
        {/* Animated gradient accent */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-500 via-amber-500 to-red-500" />

        {/* Icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500/15 to-amber-500/15 shadow-lg shadow-red-500/10">
          <AlertTriangle className="h-7 w-7 text-red-500" />
        </div>

        <h3 className="text-lg font-bold text-foreground">
          {t.common.error}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.auth.genericError}
        </p>

        {/* Error details */}
        <div className="mt-4 rounded-xl border border-red-500/15 bg-red-500/5 p-3">
          <p className="font-mono text-xs text-red-600 dark:text-red-400 line-clamp-3">
            {error.message || "Unknown error"}
          </p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            onClick={retry}
            variant="default"
            size="sm"
            className="gap-2 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/25 hover:from-elite-blue-600 hover:to-elite-blue-700"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {t.common.retry}
          </Button>
          <Button
            onClick={() => window.location.href = "/dashboard"}
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl"
            aria-label={t.nav.dashboard}
          >
            <Home className="h-3.5 w-3.5" />
            {t.nav.dashboard}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Page-level error wrapper with ErrorBoundary.
 * Use in page components:
 * ```tsx
 * <PageErrorBoundary>
 *   <YourPageContent />
 * </PageErrorBoundary>
 * ```
 */
export function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      onError={(error, info) => {
        // Could send to error reporting service
        console.error("[Page Error]", error.message, info?.componentStack)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
