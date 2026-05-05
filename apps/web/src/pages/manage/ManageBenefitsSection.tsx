import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createBenefitCard,
  deleteBenefitCard,
  fetchBenefitCards,
  updateBenefit,
  updateBenefitCard,
  type BenefitCard,
  type BenefitEntry,
} from '../../api/content'
import { useBenefits } from '../../hooks/useContent'

type Tab = 'cards' | 'categories'

const NEW_CARD: Omit<BenefitCard, 'id' | 'categorySlug'> = {
  displayOrder: 0,
  titleEs: '',
  titleEn: '',
  summaryEs: '',
  summaryEn: '',
  imageUrl: null,
  ctaUrl: null,
  ctaLabelEs: null,
  ctaLabelEn: null,
  price: null,
  bulletsEs: [],
  bulletsEn: [],
}

type CardDraft = Omit<BenefitCard, 'id'> & { id?: string }

export default function ManageBenefitsSection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('cards')

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-2 border-b border-border dark:border-[#3f3f46]" aria-label="Manage benefits">
        {(['cards', 'categories'] as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`px-3 py-1.5 font-mono text-label uppercase tracking-widest transition-colors duration-150 -mb-px border-b-2 ${
              tab === id ? 'border-primary text-primary' : 'border-transparent text-ink-secondary dark:text-[#a1a1aa] hover:text-primary'
            }`}
          >
            {t(`manage.benefits.tabs.${id}`)}
          </button>
        ))}
      </nav>
      {tab === 'cards' ? <CardsTab /> : <CategoriesTab />}
    </div>
  )
}

function CardsTab() {
  const { t } = useTranslation()
  const { data: categories, loading: catLoading } = useBenefits()
  const [cards, setCards] = useState<BenefitCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CardDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<string>('')

  useEffect(() => {
    reload()
  }, [])

  function reload() {
    setLoading(true)
    fetchBenefitCards()
      .then((data) => { setCards(data); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  const visible = useMemo(() => {
    if (!filter) return cards
    return cards.filter((c) => c.categorySlug === filter)
  }, [cards, filter])

  async function save() {
    if (!editing) return
    setBusy(true); setError(null)
    try {
      const payload: Omit<BenefitCard, 'id'> = {
        categorySlug: editing.categorySlug,
        displayOrder: editing.displayOrder,
        titleEs: editing.titleEs,
        titleEn: editing.titleEn,
        summaryEs: editing.summaryEs ?? '',
        summaryEn: editing.summaryEn ?? '',
        imageUrl: editing.imageUrl,
        ctaUrl: editing.ctaUrl,
        ctaLabelEs: editing.ctaLabelEs,
        ctaLabelEn: editing.ctaLabelEn,
        price: editing.price,
        bulletsEs: editing.bulletsEs,
        bulletsEn: editing.bulletsEn,
      }
      if (editing.id) await updateBenefitCard(editing.id, payload)
      else await createBenefitCard(payload)
      setEditing(null)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm(t('manage.benefits.cards.confirmDelete'))) return
    setError(null)
    try {
      await deleteBenefitCard(id)
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const cats = categories ?? []
  const firstCategory = cats[0]?.slug ?? ''

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
          {t('manage.benefits.cards.filter')}
        </label>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-1.5 font-body text-body-sm rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a]"
        >
          <option value="">{t('manage.benefits.cards.allCategories')}</option>
          {cats.map((c) => (
            <option key={c.slug} value={c.slug}>{c.slug}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!firstCategory}
          onClick={() => setEditing({ ...NEW_CARD, categorySlug: filter || firstCategory })}
          className="ml-auto px-3 py-1.5 rounded-sm border border-primary text-primary font-mono text-label uppercase tracking-widest hover:bg-primary hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('manage.benefits.cards.add')}
        </button>
      </div>

      {error && (
        <p className="px-3 py-2 rounded-sm bg-red-50 text-red-700 font-body text-body-sm border border-red-200">{error}</p>
      )}

      {(loading || catLoading) ? (
        <p className="text-ink-secondary dark:text-[#a1a1aa] font-body text-body-sm">{t('manage.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="text-ink-secondary dark:text-[#a1a1aa] font-body text-body-sm">{t('manage.benefits.cards.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border dark:border-[#3f3f46]">
          <table className="w-full font-body text-body-sm">
            <thead className="bg-page-bg dark:bg-[#18181b]">
              <tr className="text-left">
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.benefits.cards.col.title')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.benefits.cards.col.category')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.benefits.cards.col.price')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.benefits.cards.col.order')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className="border-t border-border dark:border-[#3f3f46]">
                  <td className="px-3 py-2">{c.titleEs} <span className="text-ink-secondary">/</span> {c.titleEn}</td>
                  <td className="px-3 py-2">{c.categorySlug}</td>
                  <td className="px-3 py-2">{c.price ?? '—'}</td>
                  <td className="px-3 py-2">{c.displayOrder}</td>
                  <td className="px-3 py-2 flex gap-2 justify-end">
                    <button onClick={() => setEditing(c)} className="text-primary font-mono text-label uppercase tracking-widest">{t('manage.edit')}</button>
                    <button onClick={() => remove(c.id)} className="text-red-600 font-mono text-label uppercase tracking-widest">{t('manage.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CardEditor
          draft={editing}
          categories={cats}
          busy={busy}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}

interface EditorProps {
  draft: CardDraft
  categories: BenefitEntry[]
  busy: boolean
  onChange: (d: CardDraft) => void
  onSave: () => void
  onCancel: () => void
}

function CardEditor({ draft, categories, busy, onChange, onSave, onCancel }: EditorProps) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-white dark:bg-[#27272a] rounded-card border border-border dark:border-[#3f3f46] p-6 flex flex-col gap-4 my-8">
        <h3 className="font-display font-bold text-h4">
          {draft.id ? t('manage.benefits.cards.editTitle') : t('manage.benefits.cards.addTitle')}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label={t('manage.benefits.cards.col.category')}
            value={draft.categorySlug}
            options={categories.map((c) => ({ value: c.slug, label: c.slug }))}
            onChange={(v) => onChange({ ...draft, categorySlug: v })}
          />
          <Field
            label={t('manage.benefits.cards.col.order')}
            type="number"
            value={String(draft.displayOrder)}
            onChange={(v) => onChange({ ...draft, displayOrder: Number(v) || 0 })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('manage.benefits.cards.titleEs')} value={draft.titleEs} onChange={(v) => onChange({ ...draft, titleEs: v })} />
          <Field label={t('manage.benefits.cards.titleEn')} value={draft.titleEn} onChange={(v) => onChange({ ...draft, titleEn: v })} />
        </div>

        <TextArea label={t('manage.benefits.cards.summaryEs')} value={draft.summaryEs} onChange={(v) => onChange({ ...draft, summaryEs: v })} />
        <TextArea label={t('manage.benefits.cards.summaryEn')} value={draft.summaryEn} onChange={(v) => onChange({ ...draft, summaryEn: v })} />

        <Field
          label={t('manage.benefits.cards.imageUrl')}
          value={draft.imageUrl ?? ''}
          onChange={(v) => onChange({ ...draft, imageUrl: v || null })}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('manage.benefits.cards.ctaUrl')}
            value={draft.ctaUrl ?? ''}
            onChange={(v) => onChange({ ...draft, ctaUrl: v || null })}
          />
          <Field
            label={t('manage.benefits.cards.price')}
            value={draft.price ?? ''}
            onChange={(v) => onChange({ ...draft, price: v || null })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('manage.benefits.cards.ctaLabelEs')}
            value={draft.ctaLabelEs ?? ''}
            onChange={(v) => onChange({ ...draft, ctaLabelEs: v || null })}
          />
          <Field
            label={t('manage.benefits.cards.ctaLabelEn')}
            value={draft.ctaLabelEn ?? ''}
            onChange={(v) => onChange({ ...draft, ctaLabelEn: v || null })}
          />
        </div>

        <TextArea
          label={t('manage.benefits.cards.bulletsEs')}
          value={draft.bulletsEs.join('\n')}
          onChange={(v) => onChange({ ...draft, bulletsEs: splitLines(v) })}
        />
        <TextArea
          label={t('manage.benefits.cards.bulletsEn')}
          value={draft.bulletsEn.join('\n')}
          onChange={(v) => onChange({ ...draft, bulletsEn: splitLines(v) })}
        />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary">
            {t('manage.cancel')}
          </button>
          <button
            type="button"
            disabled={busy || !draft.titleEs || !draft.titleEn || !draft.categorySlug}
            onClick={onSave}
            className="px-3 py-1.5 rounded-sm bg-primary text-white font-mono text-label uppercase tracking-widest disabled:opacity-50"
          >
            {busy ? '…' : t('manage.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function CategoriesTab() {
  const { t } = useTranslation()
  const { data, loading } = useBenefits()
  const [drafts, setDrafts] = useState<Record<string, BenefitEntry>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <p className="text-ink-secondary dark:text-[#a1a1aa] font-body text-body-sm">{t('manage.loading')}</p>
  const categories = data ?? []

  function draftFor(b: BenefitEntry): BenefitEntry {
    return drafts[b.slug] ?? b
  }

  function patch(slug: string, partial: Partial<BenefitEntry>) {
    const base = drafts[slug] ?? categories.find((b) => b.slug === slug)!
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
      <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa]">
        {t('manage.benefits.categories.help')}
      </p>

      {error && <p className="px-3 py-2 rounded-sm bg-red-50 text-red-700 font-body text-body-sm border border-red-200">{error}</p>}

      {categories.map((b) => {
        const d = draftFor(b)
        const dirty = drafts[b.slug] != null
        return (
          <article key={b.slug} className="p-4 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] flex flex-col gap-3">
            <header className="flex items-center justify-between">
              <h3 className="font-display font-bold text-h5">
                {t(`benefits.${b.slug}.name`, { defaultValue: b.slug })}
              </h3>
              <span className="font-mono text-label uppercase tracking-widest text-ink-secondary">{b.slug}</span>
            </header>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('manage.benefits.categories.colorVar')} value={d.colorVar} onChange={(v) => patch(b.slug, { colorVar: v })} />
              <Field
                label={t('manage.benefits.categories.order')}
                type="number"
                value={String(d.displayOrder)}
                onChange={(v) => patch(b.slug, { displayOrder: Number(v) || 0 })}
              />
            </div>

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

function splitLines(v: string): string[] {
  return v.split('\n').map((s) => s.trim()).filter(Boolean)
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm"
      />
    </label>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="px-3 py-2 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm resize-y"
      />
    </label>
  )
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
