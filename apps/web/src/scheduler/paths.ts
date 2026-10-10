import { normalizePlanId } from './utils/planUtils'

// The scheduler is mounted at /scheduler inside the CEITBA app. Its routes are
// declared relative to that (SchedulerApp), but links and navigate() calls
// take absolute paths, so build them with schedulerPath('/saved') etc.
export const SCHEDULER_BASE = '/scheduler'

export function schedulerPath(path: string): string {
  return path === '/' ? SCHEDULER_BASE : SCHEDULER_BASE + path
}

// The career picker, for a signed-in user whose profile has a career (plain
// /scheduler sends them to it). A query param, so it works in a new tab too.
export const CAREER_PICKER_PARAM = 'elegir'
export const CAREER_PICKER_PATH = `${SCHEDULER_BASE}?${CAREER_PICKER_PARAM}=1`

// A career's workspace on one of its plans (or, without one, its latest).
export function careerPath(career: string, plan?: string | null): string {
  return schedulerPath(plan ? `/${career}?plan=${encodeURIComponent(normalizePlanId(plan))}` : `/${career}`)
}
