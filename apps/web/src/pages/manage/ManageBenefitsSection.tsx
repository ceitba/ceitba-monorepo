import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import {
  createBenefit,
  createBenefitCard,
  deleteBenefit,
  deleteBenefitCard,
  fetchBenefitCards,
  updateBenefit,
  updateBenefitCard,
  type BenefitCard,
  type BenefitEntry,
} from '../../api/content'
import { useBenefitCards, useBenefits } from '../../hooks/useContent'
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
  // Only used to say how many cards a category delete takes with it.
  const { data: cards, reload: reloadCards } = useBenefitCards()
  const [drafts, setDrafts] = useState<Record<string, BenefitEntry>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<BenefitEntry | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  if (loadError && !data) {
    return <ErrorState message={t('manage.benefits.categories.loadFailed')} onRetry={() => void reload()} />
  }
  if (loading && !data) return <SkeletonCards count={3} className="flex flex-col gap-4" cardClassName="h-56" />
  const categories = data ?? []

  const createButton = (
    <Button onClick={() => setCreating(true)}>{t('manage.benefits.categories.create')}</Button>
  )
  const createModal = creating && (
    <CreateCategoryModal
      categories={categories}
      onCreated={async () => {
        await reload()
        setCreating(false)
        toast.success(t('manage.benefits.categories.created'))
      }}
      onCancel={() => setCreating(false)}
    />
  )

  if (categories.length === 0) {
    return (
      <>
        <EmptyState
          title={t('manage.benefits.categories.empty')}
          body={t('manage.benefits.categories.emptyHint')}
          action={createButton}
        />
        {createModal}
      </>
    )
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

  async function confirmDelete() {
    if (!deleting) return
    const slug = deleting.slug
    setDeleteError(null); setDeleteBusy(true)
    try {
      await deleteBenefit(slug)
      await reload()
      void reloadCards()
      setDrafts((prev) => { const { [slug]: _, ...rest } = prev; void _; return rest })
      setDeleting(null)
      toast.success(t('manage.benefits.categories.deleted'))
    } catch (e) {
      setDeleteError(adminErrorMessage(e, t))
    } finally {
      setDeleteBusy(false)
    }
  }

  // The cascade takes the category's cards with it; say how many when the
  // card list loaded, otherwise warn without a number.
  function deleteBody(b: BenefitEntry): string {
    const name = benefitCategoryName(b.slug, b, lang, t)
    if (!cards) return t('manage.benefits.categories.deleteBodyUnknown', { name })
    const count = cards.filter((c) => c.categorySlug === b.slug).length
    return t('manage.benefits.categories.deleteBody', { name, count })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="flex-1 min-w-[16rem] font-body text-body-sm text-ink-secondary dark:text-night-muted">
          {t('manage.benefits.categories.help')}
        </p>
        {createButton}
      </div>

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

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="dangerGhost" size="sm" onClick={() => { setDeleteError(null); setDeleting(b) }}>
                {t('manage.delete')}
              </Button>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
                {!dirty && (
                  <p className="font-body text-label text-ink-secondary dark:text-night-muted">{t('manage.benefits.categories.noChanges')}</p>
                )}
                <Button variant="outline" size="sm" disabled={!dirty} loading={busy === b.slug} onClick={() => save(b.slug)}>
                  {t('manage.save')}
                </Button>
              </div>
            </div>
          </article>
        )
      })}

      {createModal}

      {deleting && (
        <ConfirmDialog
          title={t('manage.benefits.categories.confirmDelete')}
          body={deleteBody(deleting)}
          confirmLabel={t('manage.benefits.categories.deleteConfirm')}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

// Same rule as the API (BenefitService): lowercase letters and digits in
// groups separated by single hyphens, 2-40 characters.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SLUG_MAX = 40

// "Educación física" -> "educacion-fisica".
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}

type SlugProblem = 'required' | 'format' | 'taken'

function slugProblem(slug: string, categories: BenefitEntry[]): SlugProblem | null {
  if (!slug) return 'required'
  if (slug.length < 2 || slug.length > SLUG_MAX || !SLUG_RE.test(slug)) return 'format'
  if (categories.some((c) => c.slug === slug)) return 'taken'
  return null
}

function CreateCategoryModal({
  categories,
  onCreated,
  onCancel,
}: {
  categories: BenefitEntry[]
  onCreated: () => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [nameEs, setNameEs] = useState('')
  const [nameEn, setNameEn] = useState('')
  // The slug follows the Spanish name until staff edit it by hand.
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [colorVar, setColorVar] = useState(() => {
    const used = new Set(categories.map((c) => c.colorVar))
    return colorVarOf(CATEGORY_COLORS.find((c) => !used.has(colorVarOf(c))) ?? CATEGORY_COLORS[0])
  })
  const [displayOrder, setDisplayOrder] = useState(() =>
    categories.length === 0 ? 0 : Math.max(...categories.map((c) => c.displayOrder)) + 1)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  // A slug the server rejected (taken by a category created meanwhile, or
  // refused by its validation), so the field shows it until it changes.
  const [rejected, setRejected] = useState<{ slug: string; problem: SlugProblem } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const effectiveSlug = slugEdited ? slug : slugify(nameEs)
  const problem = slugProblem(effectiveSlug, categories)
    ?? (rejected?.slug === effectiveSlug ? rejected.problem : null)
  const nameMissing = !nameEs.trim()
  // Don't nag before the first submit, except about a hand-typed slug.
  const showSlugError = problem != null && (submitted || (slugEdited && problem !== 'required'))
  const slugError = showSlugError ? t(`manage.benefits.categories.slugErrors.${problem}`) : undefined
  const nameError = submitted && nameMissing ? t('manage.benefits.categories.nameEsRequired') : undefined

  async function submit() {
    setSubmitted(true)
    setError(null)
    if (nameMissing || problem) return
    setBusy(true)
    try {
      await createBenefit(effectiveSlug, {
        colorVar,
        displayOrder,
        linkUrl: null,
        contactEmail: null,
        highlightsEs: [],
        highlightsEn: [],
        nameEs: nameEs.trim(),
        nameEn: nameEn.trim() || null,
      })
      await onCreated()
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.code === 'InvalidSlug')) {
        console.error(e)
        setRejected({ slug: effectiveSlug, problem: e.status === 409 ? 'taken' : 'format' })
      } else {
        setError(adminErrorMessage(e, t))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('manage.benefits.categories.createTitle')}
      onClose={onCancel}
      busy={busy}
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>{t('manage.cancel')}</Button>
          <Button type="submit" form={CREATE_FORM_ID} loading={busy}>{t('manage.benefits.categories.createSubmit')}</Button>
        </>
      }
    >
      <form
        id={CREATE_FORM_ID}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => { e.preventDefault(); void submit() }}
      >
        {error && <Alert tone="error">{error}</Alert>}

        <Field label={t('manage.benefits.categories.nameEs')} required error={nameError}>
          {(p) => (
            <input
              {...p}
              value={nameEs}
              maxLength={255}
              onChange={(e) => setNameEs(e.target.value)}
              className={inputClass({ invalid: !!nameError })}
            />
          )}
        </Field>

        <Field label={t('manage.benefits.categories.nameEn')} hint={t('manage.benefits.categories.nameEnHint')}>
          {(p) => (
            <input {...p} value={nameEn} maxLength={255} onChange={(e) => setNameEn(e.target.value)} className={inputClass()} />
          )}
        </Field>

        <Field label={t('manage.benefits.categories.slug')} required hint={t('manage.benefits.categories.slugHint')} error={slugError}>
          {(p) => (
            <input
              {...p}
              value={effectiveSlug}
              maxLength={SLUG_MAX}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => { setSlugEdited(true); setSlug(e.target.value) }}
              className={inputClass({ invalid: !!slugError, className: 'font-mono' })}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ColorPicker value={colorVar} onChange={setColorVar} />
          <TextInput
            label={t('manage.benefits.categories.order')}
            type="number"
            value={String(displayOrder)}
            onChange={(v) => setDisplayOrder(Number(v) || 0)}
          />
        </div>
      </form>
    </Modal>
  )
}

const CREATE_FORM_ID = 'create-benefit-category'

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
