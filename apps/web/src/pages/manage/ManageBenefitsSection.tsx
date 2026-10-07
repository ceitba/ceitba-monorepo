import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { benefitCategoryName } from '../../utils/benefits'
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  SkeletonCards,
  SkeletonTable,
  ToggleGroup,
  inputClass,
  selectClass,
  textareaClass,
  toast,
} from '../../components/ui'
import { adminErrorMessage } from './adminErrors'

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

// The category colors the public site can paint (index.css --dept-color-*).
// The API stores the raw CSS variable name; staff only see the swatch and
// its translated name.
const CATEGORY_COLORS = ['it', 'media', 'infra', 'nautica', 'deportes', 'direct'] as const
const colorVarOf = (c: (typeof CATEGORY_COLORS)[number]) => `--dept-color-${c}`

type CardDraft = Omit<BenefitCard, 'id'> & { id?: string }

export default function ManageBenefitsSection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('cards')

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup<Tab>
        joined
        className="self-start"
        options={[
          { value: 'cards', label: t('manage.benefits.tabs.cards') },
          { value: 'categories', label: t('manage.benefits.tabs.categories') },
        ]}
        value={tab}
        onChange={setTab}
        label={t('manage.benefits.tabsAria')}
      />
      <div>
        {tab === 'cards' ? <CardsTab onShowCategories={() => setTab('categories')} /> : <CategoriesTab />}
      </div>
    </div>
  )
}

function CardsTab({ onShowCategories }: { onShowCategories: () => void }) {
  const { t, i18n } = useTranslation()
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es'
  const { data: categories, loading: catLoading, error: catError, reload: reloadCategories } = useBenefits()
  const [cards, setCards] = useState<BenefitCard[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CardDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<BenefitCard | null>(null)
  const [filter, setFilter] = useState<string>('')

  const reload = useCallback(() => {
    setLoading(true)
    fetchBenefitCards()
      .then((data) => { setCards(data); setLoadFailed(false) })
      .catch((e) => { console.error(e); setLoadFailed(true) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  const visible = useMemo(() => {
    if (!filter) return cards
    return cards.filter((c) => c.categorySlug === filter)
  }, [cards, filter])

  async function save() {
    if (!editing) return
    setBusy(true); setFormError(null)
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
      toast.success(t('manage.benefits.cards.saved'))
      reload()
    } catch (e) {
      setFormError(adminErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function confirmRemove() {
    if (!deleting) return
    setDeleteError(null); setBusy(true)
    try {
      await deleteBenefitCard(deleting.id)
      setDeleting(null)
      toast.success(t('manage.benefits.cards.deleted'))
      reload()
    } catch (e) {
      setDeleteError(adminErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  const cats = categories ?? []
  const firstCategory = cats[0]?.slug ?? ''
  const categoryName = (slug: string) => benefitCategoryName(slug, cats.find((c) => c.slug === slug), lang, t)
  const noCategories = !catLoading && !catError && cats.length === 0

  function retryAll() {
    reload()
    void reloadCategories()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('manage.benefits.cards.filter')} className="w-full sm:w-64">
          {(p) => (
            <select {...p} value={filter} onChange={(e) => setFilter(e.target.value)} className={selectClass()}>
              <option value="">{t('manage.benefits.cards.allCategories')}</option>
              {cats.map((c) => (
                <option key={c.slug} value={c.slug}>{categoryName(c.slug)}</option>
              ))}
            </select>
          )}
        </Field>
        <Button
          className="sm:ml-auto"
          disabled={!firstCategory}
          onClick={() => { setFormError(null); setEditing({ ...NEW_CARD, categorySlug: filter || firstCategory }) }}
        >
          {t('manage.benefits.cards.add')}
        </Button>
      </div>

      {noCategories && (
        <Alert
          tone="info"
          action={<Button variant="outline" size="sm" onClick={onShowCategories}>{t('manage.benefits.cards.goToCategories')}</Button>}
        >
          {t('manage.benefits.cards.needsCategory')}
        </Alert>
      )}

      {loadFailed || catError ? (
        <ErrorState message={t('manage.benefits.cards.loadFailed')} onRetry={retryAll} />
      ) : (loading || catLoading) ? (
        <SkeletonTable rows={5} cols={5} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter ? t('manage.benefits.cards.emptyFiltered') : t('manage.benefits.cards.empty')}
          body={t('manage.benefits.cards.emptyHint')}
          action={firstCategory ? (
            <Button variant="outline" onClick={() => { setFormError(null); setEditing({ ...NEW_CARD, categorySlug: filter || firstCategory }) }}>
              {t('manage.benefits.cards.add')}
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
          <table className="w-full font-body text-body-sm text-ink-primary dark:text-night-text">
            <thead className="bg-page-bg dark:bg-night-raised text-ink-secondary dark:text-night-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.benefits.cards.col.title')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.benefits.cards.col.category')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.benefits.cards.col.price')}</th>
                <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.benefits.cards.col.order')}</th>
                <th className="px-3 py-2"><span className="sr-only">{t('manage.benefits.cards.col.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className="border-t border-border dark:border-night-border">
                  <td className="px-3 py-2">
                    {lang === 'en' ? c.titleEn : c.titleEs}
                    <span className="block text-label text-ink-secondary dark:text-night-muted">{lang === 'en' ? c.titleEs : c.titleEn}</span>
                  </td>
                  <td className="px-3 py-2">{categoryName(c.categorySlug)}</td>
                  <td className="px-3 py-2">{c.price ?? '—'}</td>
                  <td className="px-3 py-2">{c.displayOrder}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => { setFormError(null); setEditing(c) }}>{t('manage.edit')}</Button>
                      <Button variant="dangerGhost" size="sm" onClick={() => { setDeleteError(null); setDeleting(c) }}>{t('manage.delete')}</Button>
                    </div>
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
          categoryName={categoryName}
          busy={busy}
          error={formError}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('manage.benefits.cards.confirmDelete')}
          body={t('manage.benefits.cards.deleteBody', { title: lang === 'en' ? deleting.titleEn : deleting.titleEs })}
          confirmLabel={t('manage.benefits.cards.deleteConfirm')}
          busy={busy}
          error={deleteError}
          onConfirm={confirmRemove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

interface EditorProps {
  draft: CardDraft
  categories: BenefitEntry[]
  categoryName: (slug: string) => string
  busy: boolean
  error: string | null
  onChange: (d: CardDraft) => void
  onSave: () => void
  onCancel: () => void
}

function CardEditor({ draft, categories, categoryName, busy, error, onChange, onSave, onCancel }: EditorProps) {
  const { t } = useTranslation()
  const missingTitles = !draft.titleEs.trim() || !draft.titleEn.trim()
  return (
    <Modal
      title={draft.id ? t('manage.benefits.cards.editTitle') : t('manage.benefits.cards.addTitle')}
      onClose={onCancel}
      busy={busy}
      size="2xl"
      footer={
        <>
          {missingTitles && (
            <p className="mr-auto font-body text-label text-ink-secondary dark:text-night-muted">{t('manage.benefits.cards.titlesRequired')}</p>
          )}
          <Button variant="ghost" disabled={busy} onClick={onCancel}>{t('manage.cancel')}</Button>
          <Button loading={busy} disabled={missingTitles || !draft.categorySlug} onClick={onSave}>{t('manage.save')}</Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('manage.benefits.cards.col.category')}>
          {(p) => (
            <select {...p} value={draft.categorySlug} onChange={(e) => onChange({ ...draft, categorySlug: e.target.value })} className={selectClass()}>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{categoryName(c.slug)}</option>)}
            </select>
          )}
        </Field>
        <TextInput
          label={t('manage.benefits.cards.col.order')}
          type="number"
          value={String(draft.displayOrder)}
          onChange={(v) => onChange({ ...draft, displayOrder: Number(v) || 0 })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput required label={t('manage.benefits.cards.titleEs')} value={draft.titleEs} onChange={(v) => onChange({ ...draft, titleEs: v })} />
        <TextInput required label={t('manage.benefits.cards.titleEn')} value={draft.titleEn} onChange={(v) => onChange({ ...draft, titleEn: v })} />
      </div>

      <TextArea label={t('manage.benefits.cards.summaryEs')} value={draft.summaryEs} onChange={(v) => onChange({ ...draft, summaryEs: v })} />
      <TextArea label={t('manage.benefits.cards.summaryEn')} value={draft.summaryEn} onChange={(v) => onChange({ ...draft, summaryEn: v })} />

      <TextInput
        label={t('manage.benefits.cards.imageUrl')}
        type="url"
        value={draft.imageUrl ?? ''}
        onChange={(v) => onChange({ ...draft, imageUrl: v || null })}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput
          label={t('manage.benefits.cards.ctaUrl')}
          type="url"
          value={draft.ctaUrl ?? ''}
          onChange={(v) => onChange({ ...draft, ctaUrl: v || null })}
        />
        <TextInput
          label={t('manage.benefits.cards.price')}
          value={draft.price ?? ''}
          onChange={(v) => onChange({ ...draft, price: v || null })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput
          label={t('manage.benefits.cards.ctaLabelEs')}
          value={draft.ctaLabelEs ?? ''}
          onChange={(v) => onChange({ ...draft, ctaLabelEs: v || null })}
        />
        <TextInput
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
    </Modal>
  )
}

function CategoriesTab() {
  const { t, i18n } = useTranslation()
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es'
  const { data, loading, error: loadError, reload } = useBenefits()
  const [drafts, setDrafts] = useState<Record<string, BenefitEntry>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (loadError && !data) {
    return <ErrorState message={t('manage.benefits.categories.loadFailed')} onRetry={() => void reload()} />
  }
  if (loading && !data) return <SkeletonCards count={3} className="flex flex-col gap-4" cardClassName="h-56" />
  const categories = data ?? []

  if (categories.length === 0) {
    return <EmptyState title={t('manage.benefits.categories.empty')} body={t('manage.benefits.categories.emptyHint')} />
  }

  function draftFor(b: BenefitEntry): BenefitEntry {
    return drafts[b.slug] ?? b
  }

  function patch(slug: string, partial: Partial<BenefitEntry>) {
    const base = drafts[slug] ?? categories.find((b) => b.slug === slug)!
    setDrafts((prev) => ({ ...prev, [slug]: { ...base, ...partial } }))
  }

  async function save(slug: string) {
    setErrors(({ [slug]: _, ...rest }) => { void _; return rest })
    setBusy(slug)
    try {
      const d = drafts[slug]
      if (!d) return
      const { slug: _slug, ...payload } = d
      void _slug
      await updateBenefit(slug, payload)
      // Refetch before dropping the draft so the inputs show the saved
      // values instead of snapping back to the stale list.
      await reload()
      setDrafts((prev) => { const { [slug]: _, ...rest } = prev; void _; return rest })
      toast.success(t('manage.benefits.categories.saved'))
    } catch (e) {
      setErrors((prev) => ({ ...prev, [slug]: adminErrorMessage(e, t) }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
        {t('manage.benefits.categories.help')}
      </p>

      {categories.map((b) => {
        const d = draftFor(b)
        const dirty = drafts[b.slug] != null
        return (
          <article key={b.slug} className="p-4 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface flex flex-col gap-4">
            <h3 className="flex items-center gap-2 font-display font-bold text-h5 text-ink-primary dark:text-night-text">
              <span className="w-3 h-3 rounded-full flex-shrink-0 border border-border dark:border-night-border" style={{ backgroundColor: `var(${d.colorVar})` }} aria-hidden="true" />
              {benefitCategoryName(b.slug, d, lang, t)}
            </h3>

            {errors[b.slug] && <Alert tone="error">{errors[b.slug]}</Alert>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput label={t('manage.benefits.categories.nameEs')} value={d.nameEs ?? ''} onChange={(v) => patch(b.slug, { nameEs: v || null })} />
              <TextInput label={t('manage.benefits.categories.nameEn')} value={d.nameEn ?? ''} onChange={(v) => patch(b.slug, { nameEn: v || null })} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ColorPicker value={d.colorVar} onChange={(v) => patch(b.slug, { colorVar: v })} />
              <TextInput
                label={t('manage.benefits.categories.order')}
                type="number"
                value={String(d.displayOrder)}
                onChange={(v) => patch(b.slug, { displayOrder: Number(v) || 0 })}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {!dirty && (
                <p className="font-body text-label text-ink-secondary dark:text-night-muted">{t('manage.benefits.categories.noChanges')}</p>
              )}
              <Button variant="outline" size="sm" disabled={!dirty} loading={busy === b.slug} onClick={() => save(b.slug)}>
                {t('manage.save')}
              </Button>
            </div>
          </article>
        )
      })}
    </div>
  )
}

// Swatch radio group over the site's category colors. A value outside the
// set (set by hand in the database) stays selected as "Personalizado".
function ColorPicker({ value, onChange }: { value: string; onChange: (colorVar: string) => void }) {
  const { t } = useTranslation()
  const known = CATEGORY_COLORS.some((c) => colorVarOf(c) === value)
  const options: { key: string; colorVar: string; label: string }[] = CATEGORY_COLORS.map((c) => ({
    key: c,
    colorVar: colorVarOf(c),
    label: t(`manage.benefits.categories.colors.${c}`),
  }))
  if (!known && value) options.push({ key: 'custom', colorVar: value, label: t('manage.benefits.categories.colors.custom') })
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
        {t('manage.benefits.categories.color')}
      </legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const selected = o.colorVar === value
          return (
            <label key={o.key} className="relative inline-flex items-center justify-center w-11 h-11 cursor-pointer">
              <input
                type="radio"
                className="peer sr-only"
                checked={selected}
                onChange={() => onChange(o.colorVar)}
                aria-label={o.label}
              />
              <span
                aria-hidden="true"
                className={`w-8 h-8 rounded-full border transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-primary ${
                  selected
                    ? 'border-primary dark:border-primary-300 ring-2 ring-primary dark:ring-primary-300 ring-offset-2 ring-offset-white dark:ring-offset-night-surface'
                    : 'border-border dark:border-night-border'
                }`}
                style={{ backgroundColor: `var(${o.colorVar})` }}
              />
            </label>
          )
        })}
      </div>
      <p className="font-body text-label text-ink-secondary dark:text-night-muted">
        {options.find((o) => o.colorVar === value)?.label ?? t('manage.benefits.categories.colors.none')}
      </p>
    </fieldset>
  )
}

function splitLines(v: string): string[] {
  return v.split('\n').map((s) => s.trim()).filter(Boolean)
}

function TextInput({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <Field label={label} required={required}>
      {(p) => <input {...p} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass()} />}
    </Field>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      {(p) => <textarea {...p} value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={textareaClass({ className: 'resize-y' })} />}
    </Field>
  )
}
