import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createStaffMember,
  deleteStaffMember,
  fetchStaffMembers,
  fetchStaffYears,
  updateStaffMember,
  type StaffMember,
} from '../../api/content'
import { useDepartments } from '../../hooks/useContent'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import {
  Alert, Button, EmptyState, ErrorState, Field, SkeletonTable, inputClass, selectClass,
} from '../../components/ui'
import { adminErrorMessage } from './adminErrors'

const NEW_MEMBER: Omit<StaffMember, 'id'> = {
  year: new Date().getFullYear(),
  departmentSlug: '',
  displayOrder: 0,
  name: '',
  roleEs: '',
  roleEn: '',
  photoUrl: null,
  linkedinUrl: null,
  email: null,
}

type Draft = Omit<StaffMember, 'id'> & { id?: string }

export default function ManageStaffSection() {
  const { t } = useTranslation()
  const { data: departments } = useDepartments()
  const [years, setYears] = useState<number[]>([])
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [members, setMembers] = useState<StaffMember[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [yearsError, setYearsError] = useState(false)
  const [yearsTick, setYearsTick] = useState(0)
  // Save/delete failures stay inside the open dialog.
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<StaffMember | null>(null)
  const [loadingMembers, setLoadingMembers] = useState(true)
  // Only the latest roster request may write state: switching years quickly
  // must not let an older year's response land last (Edit/Delete would then
  // act on the wrong year's members).
  const reqIdRef = useRef(0)
  // Bumped by reloadMembers() after a mutation; the fetch lives in the effect
  // so it always targets the currently selected year.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let active = true
    setYearsError(false)
    fetchStaffYears()
      .then((y) => { if (active) setYears(y) })
      .catch((e) => { console.error(e); if (active) setYearsError(true) })
    return () => { active = false }
  }, [yearsTick])
  // Clear the previous year's rows right away so they can't be edited or
  // deleted while the new year loads.
  useEffect(() => { setMembers([]) }, [year])

  useEffect(() => {
    const id = ++reqIdRef.current
    setLoadingMembers(true)
    fetchStaffMembers(year)
      .then((data) => {
        if (reqIdRef.current !== id) return
        setMembers(data)
        setLoadError(null)
      })
      .catch((e: unknown) => {
        if (reqIdRef.current !== id) return
        setMembers([])
        setLoadError(adminErrorMessage(e, t))
      })
      .finally(() => {
        if (reqIdRef.current === id) setLoadingMembers(false)
      })
  }, [year, refreshTick, t])

  function reloadMembers() {
    setRefreshTick((n) => n + 1)
  }

  const grouped = useMemo(() => {
    const m = new Map<string, StaffMember[]>()
    for (const x of members) {
      if (!m.has(x.departmentSlug)) m.set(x.departmentSlug, [])
      m.get(x.departmentSlug)!.push(x)
    }
    return m
  }, [members])

  async function save() {
    if (!editing) return
    setSaveError(null); setBusy(true)
    try {
      const payload = { ...editing }
      delete (payload as { id?: string }).id
      if (editing.id) await updateStaffMember(editing.id, payload)
      else await createStaffMember(payload)
      setEditing(null)
      reloadMembers()
      // Refresh year list — a brand-new year would otherwise miss its tab.
      const nextYears = await fetchStaffYears()
      setYears(nextYears)
    } catch (e) {
      setSaveError(adminErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function confirmRemove() {
    if (!deleting) return
    setDeleteError(null); setBusy(true)
    try {
      await deleteStaffMember(deleting.id)
      setDeleting(null)
      reloadMembers()
    } catch (e) {
      setDeleteError(adminErrorMessage(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('manage.staff.year')}>
          {(p) => (
            <select
              {...p}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className={selectClass({ className: '!w-auto min-w-[8rem]' })}
            >
              {(years.length > 0 ? years : [year]).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </Field>
        <Button
          className="ml-auto"
          onClick={() => { setSaveError(null); setEditing({ ...NEW_MEMBER, year, departmentSlug: departments?.[0]?.slug ?? '' }) }}
        >
          {t('manage.staff.add')}
        </Button>
      </div>

      {yearsError && (
        <Alert
          tone="warning"
          action={<Button size="sm" variant="outline" onClick={() => setYearsTick((n) => n + 1)}>{t('errors.retry')}</Button>}
        >
          {t('manage.staff.yearsError')}
        </Alert>
      )}

      {loadError && <ErrorState message={loadError} onRetry={reloadMembers} />}

      {!loadError && Array.from(grouped.entries()).map(([deptSlug, list]) => (
        <section key={deptSlug}>
          <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text mb-3">
            {t(`departments.${deptSlug}.name`, { defaultValue: deptSlug })}
          </h3>
          <div className="overflow-x-auto rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
            <table className="w-full font-body text-body-sm">
              <thead className="bg-page-bg dark:bg-night-raised text-ink-secondary dark:text-night-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.name')}</th>
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.role')}</th>
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.order')}</th>
                  <th className="px-3 py-2"><span className="sr-only">{t('manage.staff.col.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="border-t border-border dark:border-night-border align-middle">
                    <td className="px-3 py-2 text-ink-primary dark:text-night-text">{m.name}</td>
                    <td className="px-3 py-2 text-ink-secondary dark:text-night-muted">{m.roleEs} / {m.roleEn}</td>
                    <td className="px-3 py-2 tabular-nums">{m.displayOrder}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setSaveError(null); setEditing(m) }}
                          aria-label={t('manage.staff.editAria', { name: m.name })}
                        >
                          {t('manage.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="dangerGhost"
                          onClick={() => { setDeleteError(null); setDeleting(m) }}
                          aria-label={t('manage.staff.deleteAria', { name: m.name })}
                        >
                          {t('manage.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {!loadError && loadingMembers && grouped.size === 0 && <SkeletonTable rows={6} cols={4} />}

      {!loadingMembers && !loadError && grouped.size === 0 && (
        <EmptyState
          title={t('manage.staff.noneForYear', { year })}
          body={t('manage.staff.noneForYearHint')}
          action={
            <Button
              variant="outline"
              onClick={() => { setSaveError(null); setEditing({ ...NEW_MEMBER, year, departmentSlug: departments?.[0]?.slug ?? '' }) }}
            >
              {t('manage.staff.add')}
            </Button>
          }
        />
      )}

      {editing && (
        <MemberEditor
          draft={editing}
          departments={departments ?? []}
          busy={busy}
          error={saveError}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('manage.staff.confirmDelete')}
          body={t('manage.staff.deleteBody', { name: deleting.name, year: deleting.year })}
          confirmLabel={t('manage.delete')}
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
  draft: Draft
  departments: { slug: string; colorVar: string; displayOrder: number }[]
  busy: boolean
  error: string | null
  onChange: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
}

function MemberEditor({ draft, departments, busy, error, onChange, onSave, onCancel }: EditorProps) {
  const { t } = useTranslation()
  return (
    <Modal
      title={draft.id ? t('manage.staff.editTitle') : t('manage.staff.addTitle')}
      onClose={onCancel}
      busy={busy}
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>{t('manage.cancel')}</Button>
          <Button loading={busy} onClick={onSave}>{t('manage.save')}</Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <TextInput label={t('manage.staff.col.name')} value={draft.name} onChange={(v) => onChange({ ...draft, name: v })} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput label={t('manage.staff.year')} type="number" value={String(draft.year)} onChange={(v) => onChange({ ...draft, year: Number(v) })} />
        <Field label={t('manage.staff.col.department')}>
          {(p) => (
            <select
              {...p}
              value={draft.departmentSlug}
              onChange={(e) => onChange({ ...draft, departmentSlug: e.target.value })}
              className={selectClass()}
            >
              {departments.map((d) => (
                <option key={d.slug} value={d.slug}>{t(`departments.${d.slug}.name`, { defaultValue: d.slug })}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput label={t('manage.staff.roleEs')} value={draft.roleEs} onChange={(v) => onChange({ ...draft, roleEs: v })} />
        <TextInput label={t('manage.staff.roleEn')} value={draft.roleEn} onChange={(v) => onChange({ ...draft, roleEn: v })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput label={t('manage.staff.col.order')} type="number" value={String(draft.displayOrder)} onChange={(v) => onChange({ ...draft, displayOrder: Number(v) })} />
        <TextInput label={t('manage.staff.email')} type="email" value={draft.email ?? ''} onChange={(v) => onChange({ ...draft, email: v || null })} />
      </div>
      <TextInput label={t('manage.staff.photoUrl')} type="url" value={draft.photoUrl ?? ''} onChange={(v) => onChange({ ...draft, photoUrl: v || null })} />
      <TextInput label={t('manage.staff.linkedinUrl')} type="url" value={draft.linkedinUrl ?? ''} onChange={(v) => onChange({ ...draft, linkedinUrl: v || null })} />
    </Modal>
  )
}

function TextInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <Field label={label}>
      {(p) => <input {...p} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass()} />}
    </Field>
  )
}
