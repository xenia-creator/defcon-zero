import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Button } from './components/ui'
import { ApiError } from './lib/api'
import './index.css'

const queries = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5_000,
      // Retry network trouble, not answers the server gave on purpose
      retry: (count, error) => !(error instanceof ApiError) && count < 3,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <ErrorBoundary
        fallback={() => (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="stamp text-2xl text-alert">System fault</p>
            <p className="text-sm text-muted">The screen hit a problem. Your draft is saved in this browser and on the server's version history.</p>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        )}
      >
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
)
