import { useTranslation } from 'react-i18next'
import { REASONING_EFFORTS, type KbModel, type ReasoningEffort } from '../../../api/kbAdmin'
import { FIELD } from './shared'

// "Razonamiento" select next to a model picker: enabled only when the
// chosen model supports reasoning effort; null = the model's default.
export default function ReasoningSelect({ model, value, onChange, label }: {
  model: KbModel | undefined
  value: ReasoningEffort | null | undefined
  onChange: (v: ReasoningEffort | null) => void
  label: string
}) {
  const { t } = useTranslation()
  const supported = !!model?.supportsReasoningEffort
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[0.68rem] uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.reasoning.label')}</span>
      <select
        aria-label={label}
        value={supported ? value ?? '' : ''}
        disabled={!supported}
        onChange={(e) => onChange((e.target.value || null) as ReasoningEffort | null)}
        title={supported ? t('manage.wikiAi.reasoning.hint') : t('manage.wikiAi.reasoning.unsupported')}
        className={`${FIELD} py-1.5`}
      >
        <option value="">{supported ? t('manage.wikiAi.reasoning.default') : t('manage.wikiAi.reasoning.na')}</option>
        {REASONING_EFFORTS.map((r) => <option key={r} value={r}>{t(`manage.wikiAi.reasoning.levels.${r}`)}</option>)}
      </select>
    </label>
  )
}
