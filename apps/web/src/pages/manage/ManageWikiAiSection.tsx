import '../../i18nApuntes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Overview from './wikiAdmin/Overview'
import SettingsView from './wikiAdmin/SettingsView'
import ModelsView from './wikiAdmin/ModelsView'
import RunsView from './wikiAdmin/RunsView'
import EvalsView from './wikiAdmin/EvalsView'

type View = 'overview' | 'settings' | 'models' | 'runs' | 'evals'
const VIEWS: View[] = ['overview', 'settings', 'models', 'runs', 'evals']

// /manage → "Wiki IA": models per pipeline stage, costs, runs and model
// evaluations for the AI subject wikis (CEITBA-API SUBJECT-WIKI-ADMIN.md).
export default function ManageWikiAiSection() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('overview')
  const [runId, setRunId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-3xl">{t('manage.wikiAi.intro')}</p>
      <div role="group" aria-label={t('manage.wikiAi.viewsAria')} className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => { setView(v); if (v !== 'runs') setRunId(null) }}
            className={`px-3 py-1.5 rounded-sm font-mono text-label uppercase tracking-widest border transition-colors ${
              view === v ? 'bg-primary text-white border-primary' : 'border-border dark:border-night-border text-ink-secondary dark:text-night-muted hover:text-primary hover:border-primary'
            }`}
          >
            {t(`manage.wikiAi.views.${v}`)}
          </button>
        ))}
      </div>
      {view === 'overview' && <Overview onOpenRun={(id) => { setRunId(id); setView('runs') }} />}
      {view === 'settings' && <SettingsView />}
      {view === 'models' && <ModelsView />}
      {view === 'runs' && <RunsView openId={runId} onOpen={setRunId} />}
      {view === 'evals' && <EvalsView />}
    </div>
  )
}
