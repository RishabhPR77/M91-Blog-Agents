// Providers: TanStack Query (with error toasts), the router, the 401 → login redirect, and toasts.
import { useEffect, useState } from 'react'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { errorMessage, isApiError, setUnauthorizedHandler } from './api/client'
import { AppRoutes } from './router'
import { Toasts, toast } from './components/Toasts'

/** Network errors retry quietly (twice); API errors (4xx/5xx) are not retried. */
export function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.silent) return
        if (isApiError(error) && error.status === 401) return
        toast('error', errorMessage(error))
      }
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isApiError(error) && error.status === 401) return
        toast('error', errorMessage(error))
      }
    }),
    defaultOptions: {
      queries: {
        retry: (count, error) => isApiError(error) && error.status === 0 && count < 2,
        refetchOnWindowFocus: false
      }
    }
  })
}

function UnauthorizedRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (location.pathname === '/login') return
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate, location.pathname, location.search])
  return null
}

export default function App() {
  const [client] = useState(makeQueryClient)
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <UnauthorizedRedirect />
        <AppRoutes />
      </BrowserRouter>
      <Toasts />
    </QueryClientProvider>
  )
}
