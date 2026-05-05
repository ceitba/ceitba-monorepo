import { useEffect, useState } from 'react'
import {
  fetchBenefits,
  fetchDepartments,
  fetchStaffMembers,
  fetchStaffYears,
  type BenefitEntry,
  type DepartmentEntry,
  type StaffMember,
} from '../api/content'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let active = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fetcher()
      .then((data) => { if (active) setState({ data, loading: false, error: null }) })
      .catch((err: Error) => { if (active) setState({ data: null, loading: false, error: err.message }) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export function useDepartments(): AsyncState<DepartmentEntry[]> {
  return useFetch(fetchDepartments)
}

export function useBenefits(): AsyncState<BenefitEntry[]> {
  return useFetch(fetchBenefits)
}

export function useStaffYears(): AsyncState<number[]> {
  return useFetch(fetchStaffYears)
}

export function useStaffMembers(year: number | null): AsyncState<StaffMember[]> {
  return useFetch(() => (year == null ? Promise.resolve([]) : fetchStaffMembers(year)), [year])
}
