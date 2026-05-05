import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updateBenefit, type BenefitEntry } from '../../api/content'
import { useBenefits } from '../../hooks/useContent'

export default function ManageBenefitsSection() {
  const { t } = useTranslation()
  const { data, loading } = useBenefits()
  // Local working copy: edits stay in memory until "save" hits the API.
  const [drafts, setDrafts] = useState<Record<string, BenefitEntry>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <p>{t('manage.loading')}</p>
  const benefits = data ?? []

  function draftFor(b: BenefitEntry): BenefitEntry {
    return drafts[b.slug] ?? b
  }

  function patch(slug: string, partial: Partial<BenefitEntry>) {
    const base = drafts[slug] ?? benefits.find((b) => b.slug === slug)!
    setDrafts((prev) => ({ ...prev, [slug]: { ...base, ...partial } }))
  }

  async function save(slug: string) {
    setError(null); setBusy(slug)
    try {
      const d = drafts[slug]
      if (!d) return
      const { slug: _slug, ...payload } = d
      void _slug
      await updateBenefit(slug, payload)
      setDrafts((prev) => { const { [slug]: _, ...rest } = prev; void _; return rest })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="px-3 py-2 rounded-sm bg-red-50 text-red-700 font-body text-body-sm border border-red-200">{error}</p>}

      {benefits.map((b) => {
        const d = draftFor(b)
        const dirty = drafts[b.slug] != null
        return (
          <article key={b.slug} className="p-4 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] flex flex-col gap-3">
            <header className="flex items-center justify-between">
              <h3 className="font-display font-bold text-h5">{t(`benefits.${b.slug}.name`, { defaultValue: b.slug })}</h3>
              <span className="font-mono text-label uppercase tracking-widest text-ink-secondary">{b.slug}</span>
            </header>

            <div className="grid grid-cols-2 gap-3">
              <LabeledInput label={t('manage.benefits.linkUrl')} value={d.linkUrl ?? ''} onChange={(v) => patch(b.slug, { linkUrl: v || null })} />
              <LabeledInput label={t('manage.benefits.contact')} value={d.contactEmail ?? ''} onChange={(v) => patch(b.slug, { contactEmail: v || null })} />
            </div>

            <LabeledTextArea
              label="Highlights (ES)"
              value={d.highlightsEs.join('\n')}
              onChange={(v) => patch(b.slug, { highlightsEs: v.split('\n').map((s) => s.trim()).filter(Boolean) })}
            />
            <LabeledTextArea
              label="Highlights (EN)"
              value={d.highlightsEn.join('\n')}
              onChange={(v) => patch(b.slug, { highlightsEn: v.split('\n').map((s) => s.trim()).filter(Boolean) })}
            />

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!dirty || busy === b.slug}
                onClick={() => save(b.slug)}
                className="px-3 py-1.5 rounded-sm bg-primary text-white font-mono text-label uppercase tracking-widest disabled:opacity-40"
              >
                {busy === b.slug ? '…' : t('manage.save')}
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-1.5 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm" />
    </label>
  )
}

function LabeledTextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="px-3 py-2 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm resize-y"
      />
    </label>
  )
}
