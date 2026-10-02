import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchBenefitCards,
  fetchBenefits,
  fetchDepartments,
  fetchStaffMembers,
  fetchStaffYears,
  type BenefitCard,
  type BenefitEntry,
  type DepartmentEntry,
  type StaffMember,
} from '../api/content'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export interface FetchResult<T> extends AsyncState<T> {
  // Re-runs the fetcher, keeping the current data visible while it loads.
  // Resolves once the new state is applied (or the request was superseded).
  reload: () => Promise<void>
}

// `key` identifies the fetcher's inputs: when it changes, the data is
// refetched (the latest `fetcher` is always the one called).
function useFetch<T>(fetcher: () => Promise<T>, key: string | number | null = null): FetchResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  // Monotonic request id: only the latest request may write state, so a
  // slow response for stale deps (or after unmount) is dropped.
  const reqIdRef = useRef(0)

  const run = useCallback((): Promise<void> => {
    const id = ++reqIdRef.current
    setState((s) => ({ ...s, loading: true, error: null }))
    return fetcherRef.current()
      .then((data) => { if (reqIdRef.current === id) setState({ data, loading: false, error: null }) })
      .catch((err: Error) => { if (reqIdRef.current === id) setState({ data: null, loading: false, error: err.message }) })
  }, [])

  // Bumping the id drops any in-flight response (key changed or unmounted).
  const invalidate = useCallback(() => { reqIdRef.current++ }, [])

  useEffect(() => {
    void run()
    return invalidate
  }, [run, invalidate, key])

  return { ...state, reload: run }
}

export function useDepartments(): FetchResult<DepartmentEntry[]> {
  return useFetch(fetchDepartments)
}

export function useBenefits(): FetchResult<BenefitEntry[]> {
  return useFetch(fetchBenefits)
}

export function useBenefitCards(): FetchResult<BenefitCard[]> {
  return useFetch(fetchBenefitCards)
}

export function useStaffYears(): FetchResult<number[]> {
  return useFetch(fetchStaffYears)
}

export function useStaffMembers(year: number | null): FetchResult<StaffMember[]> {
  return useFetch(() => (year == null ? Promise.resolve([]) : fetchStaffMembers(year)), year)
}
