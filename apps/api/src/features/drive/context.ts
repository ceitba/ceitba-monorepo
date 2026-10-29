// What the drive services share at runtime (one set per Deps, see services.ts).
import type { DriveSyncTrigger } from './sync';

export interface Ctx { trigger: DriveSyncTrigger }
export interface AcceptSuggestionsResponseT { applied: number }
