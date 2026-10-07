import '../../i18nApuntes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs } from '@/components/ui'
import Overview from './wikiAdmin/Overview'
import SettingsView from './wikiAdmin/SettingsView'
import ModelsView from './wikiAdmin/ModelsView'
import RunsView from './wikiAdmin/RunsView'
import EvalsView from './wikiAdmin/EvalsView'
import ViewBoundary from './wikiAdmin/ViewBoundary'
import { consumeOpenRequest, markSeen, unseenCount } from './wikiAdmin/jobWatchStore'
import { useJobWatch } from './wikiAdmin/useJobWatch'

type View = 'overview' | 'settings' | 'models' | 'runs' | 'evals'
const VIEWS: View[] = ['overview', 'settings', 'models', 'runs', 'evals']

// /manage → "Wiki IA": models per pipeline stage, costs, runs and model
// evaluations for the AI subject wikis (CEITBA-API SUBJECT-WIKI-ADMIN.md).
export default function ManageWikiAiSection() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('overview')
  const [runId, setRunId] = useState<string | null>(null)
  const [evalId, setEvalId] = useState<string | null>(null)
  const watch = useJobWatch()

  // "ver resultados" from a finish toast: jump to that eval / run.
  useEffect(() => {
    if (!watch.openRequest) return
    const r = consumeOpenRequest()
    if (!r) return
    if (r.kind === 'eval') { setView('evals'); setEvalId(r.id) }
    else { setView('runs'); setRunId(r.id) }
  }, [watch.openRequest])

  // Opening a sub-view marks its finished jobs as seen (clears the dot).
  useEffect(() => {
    if (view === 'evals') markSeen('eval')
    if (view === 'runs') markSeen('run')
  }, [view, watch.jobs])

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-3xl">{t('manage.wikiAi.intro')}</p>
      <Tabs
        idPrefix="wikiai"
        label={t('manage.wikiAi.viewsAria')}
        active={view}
        onChange={(v) => { setView(v); if (v !== 'runs') setRunId(null) }}
        items={VIEWS.map((v) => ({
          id: v,
          label: t(`manage.wikiAi.views.${v}`),
          dot: (v === 'evals' && unseenCount('eval') > 0) || (v === 'runs' && unseenCount('run') > 0),
          dotLabel: t('manage.wikiAi.watch.unseen'),
        }))}
      />
      <div role="tabpanel" id={`wikiai-panel-${view}`} aria-labelledby={`wikiai-tab-${view}`}>
        <ViewBoundary key={view}>
          {view === 'overview' && <Overview onOpenRun={(id) => { setRunId(id); setView('runs') }} />}
          {view === 'settings' && <SettingsView />}
          {view === 'models' && <ModelsView />}
          {view === 'runs' && <RunsView openId={runId} onOpen={setRunId} />}
          {view === 'evals' && <EvalsView requestedId={evalId} onRequestHandled={() => setEvalId(null)} />}
        </ViewBoundary>
      </div>
    </div>
  )
}
