// The kb-reader beans, one set per Deps (constructors do no I/O). Other kb
// agents import from here:
//
//   import { kbReader } from '../kb-reader/services';
//   const kb = kbReader(deps);
//   kb.importer.importSubject(subjectId, req)        KbImportService (StaffKbController import, pipeline publish)
//   kb.importer.validate(subjectId, pages, removing)
//   kb.moderation.hide/restore/list                  KbModerationService (StaffKbController)
//   kb.moderation.hidePagesCiting(fileIds, tx)       Drive takedown hook
//   kb.moderation.forgetFiles(fileIds, tx, afterCommit)
//   kb.views.page(tx, row, viewerId, staff) / staffSources(tx, ids); summary/staffView in ./views
//   kb.embeddings.embedPending() / search(q, subjectId, k)
//   kb.relations.refresh()

import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { KbEmbeddingService } from './embeddingService';
import { KbImportService } from './importService';
import { KbModerationService } from './moderationService';
import { KbReaderService } from './readerService';
import * as repo from './repo';
import { KbSearchService } from './searchService';
import { KbViews } from './views';

/** service/kb/KbRelationService: recomputes wiki.kb_subject_relation from plan_subject.dependencies. */
export class KbRelationService {
  constructor(private readonly deps: Pick<Deps, 'db'>) {}

  /** @Transactional */
  refresh(): Promise<number> {
    return withTx(this.deps.db, (tx) => repo.refreshRelationsFromPlans(tx));
  }
}

export interface KbReaderBeans {
  reader: KbReaderService;
  search: KbSearchService;
  embeddings: KbEmbeddingService;
  importer: KbImportService;
  moderation: KbModerationService;
  relations: KbRelationService;
  views: KbViews;
}

const beans = new WeakMap<Deps, KbReaderBeans>();

export function kbReader(deps: Deps): KbReaderBeans {
  let b = beans.get(deps);
  if (!b) {
    const embeddings = KbEmbeddingService.of(deps);
    b = {
      reader: new KbReaderService(deps),
      search: new KbSearchService(embeddings, deps),
      embeddings,
      importer: new KbImportService(deps),
      moderation: new KbModerationService(deps),
      relations: new KbRelationService(deps),
      views: new KbViews(deps),
    };
    beans.set(deps, b);
  }
  return b;
}

/** A dynamic import() of a module that does not exist (an optional sibling feature). */
export function isModuleNotFound(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? '';
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(msg);
}
