// The generator lives in @ceitba/scheduler-core so apps/mcp (generate_schedules
// tool) runs exactly the same algorithm. It is pure and DOM-free: this app
// runs it inside src/workers/scheduler.worker.ts, and useScheduleGeneration
// falls back to calling it directly.
export {
  MAX_GENERATED_SCHEDULES,
  MAX_SEARCH_STEPS,
  LIMITED_OVERLAP_MINUTES,
  DEFAULT_SCHEDULER_OPTIONS,
  type GenerationResult,
  type GenerationLimits,
  intersectsBlockedTime,
  getMaxTimeOverlap,
  countFreeWeekdays,
  getGapMinutes,
  checkBuildingChanges,
  createSchedule,
  rankSchedules,
  generateSchedules
} from "@ceitba/scheduler-core";
