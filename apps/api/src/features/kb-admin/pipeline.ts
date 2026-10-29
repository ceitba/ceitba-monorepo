// The kb-pipeline beans kb-admin uses (kb-pipeline/API.md), behind one accessor.

import type { Deps } from '../../deps';
import { kbPipeline, type KbPipeline } from '../kb-pipeline/service';

export type PipelineBeans = KbPipeline;

export function pipelineBeans(deps: Deps): PipelineBeans {
  return kbPipeline(deps);
}
