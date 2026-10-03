import type { GlobalKbGraph } from '../../../api/kb'
import { subjectColor, type GraphEdge, type GraphGroup, type GraphNode } from './GraphView'

// Maps GET /wiki/kb/graph onto GraphView: nodes clustered and coloured by
// subject, cross-subject edges emphasised.
export function toGraphData(g: GlobalKbGraph) {
  const subjects = g.subjects ?? []
  const colors = new Map(subjects.map((s, i) => [s.subjectId, subjectColor(i)]))
  const names = new Map(subjects.map((s) => [s.subjectId, s.subjectName]))
  const groups: GraphGroup[] = subjects
    .filter((s) => s.pageCount > 0)
    .map((s) => ({ key: s.subjectId, label: s.subjectName, color: colors.get(s.subjectId)! }))
  const nodes: GraphNode[] = (g.nodes ?? []).map((n) => ({
    id: n.id, subjectId: n.subjectId, slug: n.slug, title: n.title, type: n.type, group: n.subjectId,
  }))
  const edges: GraphEdge[] = (g.edges ?? []).map((e) => ({ from: e.from, to: e.to, emphasized: e.crossSubject }))
  return {
    nodes,
    edges,
    groups,
    colorOf: (n: GraphNode) => colors.get(n.subjectId) ?? 'var(--kbg-muted)',
    subjectLabel: (n: GraphNode) => {
      const name = names.get(n.subjectId)
      return name ? `${n.subjectId} ${name}` : n.subjectId
    },
  }
}
