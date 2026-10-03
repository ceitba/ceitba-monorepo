import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../../api/client'
import { apuntesErrorMessage } from '../../../utils/apuntes'

// Data loading for the "Wiki IA" admin views.

export interface Loaded<T> {
  data: T | null
  loading: boolean
  error: string | null
  // The endpoint doesn't exist on this API build yet (404).
  unavailable: boolean
  reload: () => void
  setData: (fn: (d: T | null) => T | null) => void
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const { t } = useTranslation()
  const [data, setDataState] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [tick, setTick] = useState(0)
  const req = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    const id = ++req.current
    setLoading(true)
    fnRef.current()
      .then((d) => { if (req.current === id) { setDataState(d); setError(null); setUnavailable(false) } })
      .catch((e) => {
        if (req.current !== id) return
        if (isUnavailable(e)) setUnavailable(true)
        else setError(apuntesErrorMessage(e, t))
      })
      .finally(() => { if (req.current === id) setLoading(false) })
  }, [tick, t, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setTick((n) => n + 1), [])
  const setData = useCallback((f: (d: T | null) => T | null) => setDataState((d) => f(d)), [])
  return { data, loading, error, unavailable, reload, setData }
}

export function isUnavailable(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501)
}
