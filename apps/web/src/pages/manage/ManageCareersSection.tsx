import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addPlan,
  createCareer,
  fetchCareersWithPlanDetails,
  renameCareer,
  renamePlan,
  type CareerWithPlanDetails,
  type Plan,
} from '../../api/careers'
import { ApiError } from '../../api/client'
import { Alert, Button, EmptyState, ErrorState, Field, Modal, SkeletonCards, inputClass, toast } from '../../components/ui'
import { adminErrorMessage } from './adminErrors'

// What the editor is doing: one modal at a time.
type Editing =
  | { kind: 'newCareer' }
  | { kind: 'renameCareer'; career: CareerWithPlanDetails }
  | { kind: 'newPlan'; career: CareerWithPlanDetails }
  | { kind: 'renamePlan'; career: CareerWithPlanDetails; plan: Plan }

// /manage → "Carreras y planes": the catalogue users pick from in onboarding
// and the ITBA sync walks (ITBA cannot list it, so staff keeps it). Careers
// and plans are created and renamed here; ids never change once created.
export default function ManageCareersSection() {
  const { t } = useTranslation()
  const [careers, setCareers] = useState<CareerWithPlanDetails[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState<Editing | null>(null)

  useEffect(() => {
    let active = true
    setLoadFailed(false)
    fetchCareersWithPlanDetails()
      .then((data) => { if (active) setCareers(data) })
      .catch((e) => { console.error(e); if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [reloadKey])

  function done(message: string) {
    setEditing(null)
    toast.success(message)
    setReloadKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <p className="flex-1 font-body text-body-sm text-ink-secondary dark:text-night-muted max-w-3xl">
          {t('manage.careers.intro')}
        </p>
        <Button onClick={() => setEditing({ kind: 'newCareer' })}>{t('manage.careers.newCareer')}</Button>
      </div>
      {loadFailed && careers === null && (
        <ErrorState message={t('manage.careers.loadFailed')} onRetry={() => setReloadKey((k) => k + 1)} />
      )}
      {careers === null && !loadFailed && <SkeletonCards count={3} className="flex flex-col gap-3" cardClassName="h-32" />}
      {careers !== null && careers.length === 0 && (
        <EmptyState title={t('manage.careers.empty')} body={t('manage.careers.emptyHint')} />
      )}
      <ul className="flex flex-col gap-3">
        {careers?.map((c) => (
          <li key={c.id}>
            <CareerCard career={c} onEdit={setEditing} />
          </li>
        ))}
      </ul>
      {editing && <EditModal editing={editing} onClose={() => setEditing(null)} onDone={done} />}
    </div>
  )
}

function CareerCard({ career: c, onEdit }: { career: CareerWithPlanDetails; onEdit: (e: Editing) => void }) {
  const { t } = useTranslation()
  return (
    <article className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4">
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{c.name}</h2>
          <p className="mt-1 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
            {t('manage.careers.idLabel', { id: c.id })} · {t('manage.careers.planCount', { count: c.plans.length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit({ kind: 'renameCareer', career: c })}
            aria-label={t('manage.careers.renameCareerAria', { name: c.name })}>
            {t('manage.edit')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEdit({ kind: 'newPlan', career: c })}
            aria-label={t('manage.careers.newPlanAria', { name: c.name })}>
            {t('manage.careers.newPlan')}
          </Button>
        </div>
      </div>
      {c.plans.length > 0 && (
        <ul className="border-t border-border dark:border-night-border divide-y divide-border dark:divide-night-border">
          {c.plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <span className="font-mono text-body-sm text-ink-primary dark:text-night-text">{p.id}</span>
              <span className="flex-1 min-w-0 font-body text-body-sm text-ink-secondary dark:text-night-muted truncate">
                {p.name && p.name !== p.id ? p.name : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={() => onEdit({ kind: 'renamePlan', career: c, plan: p })}
                aria-label={t('manage.careers.renamePlanAria', { id: p.id })}>
                {t('manage.edit')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

// One form for the four actions: an id field when creating, a name field always.
function EditModal({ editing, onClose, onDone }: { editing: Editing; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useTranslation()
  const creating = editing.kind === 'newCareer' || editing.kind === 'newPlan'
  const isPlan = editing.kind === 'newPlan' || editing.kind === 'renamePlan'
  const [id, setId] = useState('')
  const [name, setName] = useState(
    editing.kind === 'renameCareer' ? editing.career.name
    : editing.kind === 'renamePlan' ? editing.plan.name ?? editing.plan.id
    : '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A plan's name is optional when adding it (it falls back to the id).
  const nameRequired = editing.kind !== 'newPlan'
  const valid = (!creating || id.trim() !== '') && (!nameRequired || name.trim() !== '')

  const title =
    editing.kind === 'newCareer' ? t('manage.careers.newCareer')
    : editing.kind === 'renameCareer' ? t('manage.careers.renameCareerTitle', { id: editing.career.id })
    : editing.kind === 'newPlan' ? t('manage.careers.newPlanTitle', { name: editing.career.name })
    : t('manage.careers.renamePlanTitle', { id: editing.plan.id })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError('')
    try {
      switch (editing.kind) {
        case 'newCareer':
          await createCareer(id.trim(), name.trim())
          onDone(t('manage.careers.careerCreated', { name: name.trim() }))
          break
        case 'renameCareer':
          await renameCareer(editing.career.id, name.trim())
          onDone(t('manage.careers.saved'))
          break
        case 'newPlan':
          await addPlan(editing.career.id, id.trim(), name.trim() || null)
          onDone(t('manage.careers.planCreated', { id: id.trim() }))
          break
        case 'renamePlan':
          await renamePlan(editing.career.id, editing.plan.id, name.trim())
          onDone(t('manage.careers.saved'))
          break
      }
    } catch (err) {
      // 409 on create: the id is taken (plan ids are unique across careers).
      if (creating && err instanceof ApiError && err.status === 409) {
        console.error(err)
        setError(t(isPlan ? 'manage.careers.planIdTaken' : 'manage.careers.careerIdTaken', { id: id.trim() }))
      } else {
        setError(adminErrorMessage(err, t))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('ui.cancel')}</Button>
          <Button type="submit" form="manage-career-form" loading={busy} disabled={!valid}>
            {creating ? t('manage.careers.create') : t('manage.save')}
          </Button>
        </>
      }
    >
      <form id="manage-career-form" onSubmit={submit} className="flex flex-col gap-4">
        {creating && (
          <Field
            label={t('manage.careers.idField')}
            hint={t(isPlan ? 'manage.careers.planIdHint' : 'manage.careers.careerIdHint')}
            required
          >
            {(p) => (
              <input {...p} value={id} maxLength={25} onChange={(e) => setId(e.target.value)}
                placeholder={isPlan ? 'S10-Rev23' : 'S'} className={inputClass({ className: 'font-mono' })} />
            )}
          </Field>
        )}
        <Field
          label={t('manage.careers.nameField')}
          hint={editing.kind === 'newPlan' ? t('manage.careers.planNameHint') : undefined}
          required={nameRequired}
        >
          {(p) => (
            <input {...p} value={name} maxLength={255} onChange={(e) => setName(e.target.value)} className={inputClass()} />
          )}
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  )
}
