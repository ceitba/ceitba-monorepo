// web/kb/KbController: subject wikis for logged-in readers. Requires the
// `apuntes` capability (403 CAPABILITY_REQUIRED), checked inside the handler
// after the arguments are bound (so a missing `q` or a bad body is a 400 first).
// Visibility of HIDDEN pages = StaffPowers.isStaff (withheld from API keys
// without the `staff` scope).

import { staffPowers } from '../../http/auth/context';
import { defineRoutes } from '../../http/router';
import { param } from '../../http/validation';
import { CapabilityService } from '../capability/service';
import { KbReportRequest } from './dto';
import { kbReader } from './services';

export default defineRoutes((r, deps) => {
  const kb = kbReader(deps);
  const capabilities = new CapabilityService(deps);
  const tags = ['Subject wikis'];
  const argOrder = ['user', 'params', 'query', 'body'] as const;

  r.get('/v1/wiki/kb/search', {
    tags, summary: 'Semantic search over published wiki pages (passages nearest to the query, best first)', currentUser: true,
    argOrder: [...argOrder],
    query: { q: param.string(), subjectId: param.string({ required: false }), limit: param.int({ required: false }) },
  }, async ({ user, query }) => {
    await capabilities.require(user, 'apuntes');
    return kb.search.search(user!, query.q, query.subjectId, query.limit);
  });

  r.get('/v1/wiki/subjects/{subjectId}/kb', {
    tags, summary: "A subject's wiki: index page, page list and related subjects", currentUser: true, argOrder: [...argOrder],
    params: { subjectId: param.string() },
  }, async ({ c, user, params }) => {
    await capabilities.require(user, 'apuntes');
    return kb.reader.subject(user!, params.subjectId!, await staffPowers(c).isStaff(user!.id));
  });

  r.get('/v1/wiki/subjects/{subjectId}/kb/graph', {
    tags, summary: 'Pages of the subject and the pages of other subjects they link to or from', currentUser: true,
    argOrder: [...argOrder], params: { subjectId: param.string() },
  }, async ({ c, user, params }) => {
    await capabilities.require(user, 'apuntes');
    return kb.reader.graph(user!, params.subjectId!, await staffPowers(c).isStaff(user!.id));
  });

  r.get('/v1/wiki/subjects/{subjectId}/kb/{slug}', {
    tags, summary: 'One wiki page with its resolved links, backlinks and sources', currentUser: true, argOrder: [...argOrder],
    params: { subjectId: param.string(), slug: param.string() },
  }, async ({ c, user, params }) => {
    await capabilities.require(user, 'apuntes');
    return kb.reader.page(user!, params.subjectId!, params.slug!, await staffPowers(c).isStaff(user!.id));
  });

  r.put('/v1/wiki/kb/pages/{pageId}/report', {
    tags, summary: 'Report a page (one report per user; 3 reports hide it)', currentUser: true, argOrder: [...argOrder],
    params: { pageId: param.uuid() }, body: KbReportRequest, status: 204,
  }, async ({ user, params, body }) => {
    await capabilities.require(user, 'apuntes');
    await kb.reader.report(user!, params.pageId!, body);
  });
});
