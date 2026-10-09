// The scheduler is mounted at /scheduler inside the CEITBA app. Its routes are
// declared relative to that (SchedulerApp), but links and navigate() calls
// take absolute paths, so build them with schedulerPath('/saved') etc.
export const SCHEDULER_BASE = '/scheduler'

export function schedulerPath(path: string): string {
  return path === '/' ? SCHEDULER_BASE : SCHEDULER_BASE + path
}
