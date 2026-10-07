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
import ErrorBanner from '../../components/ErrorBanner'
import Modal from '../../components/Modal'

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
  const [error, setError] = useState<string | null>(null)
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

  useEffect(() => { fetchStaffYears().then(setYears).catch(() => setYears([])) }, [])
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
        setError(null)
      })
      .catch((e: Error) => {
        if (reqIdRef.current !== id) return
        setMembers([])
        setError(e.message)
      })
      .finally(() => {
        if (reqIdRef.current === id) setLoadingMembers(false)
      })
  }, [year, refreshTick])

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
    setError(null); setBusy(true)
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
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmRemove() {
    if (!deleting) return
    setError(null); setBusy(true)
    try {
      await deleteStaffMember(deleting.id)
      setDeleting(null)
      reloadMembers()
    } catch (e) {
      setDeleting(null)
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('manage.staff.year')}
        </label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-1.5 font-body text-body-sm rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface"
        >
          {(years.length > 0 ? years : [year]).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setEditing({ ...NEW_MEMBER, year, departmentSlug: departments?.[0]?.slug ?? '' })}
          className="ml-auto px-3 py-1.5 rounded-sm border border-primary text-primary font-mono text-label uppercase tracking-widest hover:bg-primary hover:text-white transition-colors"
        >
          {t('manage.staff.add')}
        </button>
      </div>

      {error && (
        <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>
      )}

      {Array.from(grouped.entries()).map(([deptSlug, list]) => (
        <section key={deptSlug}>
          <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text mb-3">
            {t(`departments.${deptSlug}.name`, { defaultValue: deptSlug })}
          </h3>
          <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
            <table className="w-full font-body text-body-sm">
              <thead className="bg-page-bg dark:bg-night-bg">
                <tr className="text-left">
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.name')}</th>
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.role')}</th>
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.order')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="border-t border-border dark:border-night-border">
                    <td className="px-3 py-2">{m.name}</td>
                    <td className="px-3 py-2">{m.roleEs} / {m.roleEn}</td>
                    <td className="px-3 py-2">{m.displayOrder}</td>
                    <td className="px-3 py-2 flex gap-2 justify-end">
                      <button type="button" onClick={() => setEditing(m)} className="text-primary font-mono text-label uppercase tracking-widest">{t('manage.edit')}</button>
                      <button type="button" onClick={() => setDeleting(m)} className="text-red-600 dark:text-red-400 font-mono text-label uppercase tracking-widest">{t('manage.delete')}</button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-secondary dark:text-night-muted">{t('manage.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {loadingMembers && grouped.size === 0 && (
        <p className="text-ink-secondary dark:text-night-muted font-body text-body-sm">{t('manage.loading')}</p>
      )}

      {!loadingMembers && !error && grouped.size === 0 && (
        <p className="text-ink-secondary dark:text-night-muted font-body text-body-sm">{t('manage.staff.noneForYear')}</p>
      )}

      {editing && (
        <MemberEditor
          draft={editing}
          departments={departments ?? []}
          busy={busy}
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
  onChange: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
}

function MemberEditor({ draft, departments, busy, onChange, onSave, onCancel }: EditorProps) {
  const { t } = useTranslation()
  return (
    <Modal
      title={draft.id ? t('manage.staff.editTitle') : t('manage.staff.addTitle')}
      onClose={onCancel}
      busy={busy}
      size="lg"
      footer={
        <>
          <button type="button" disabled={busy} onClick={onCancel} className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted disabled:opacity-50">{t('manage.cancel')}</button>
          <button type="button" disabled={busy} onClick={onSave} className="px-3 py-1.5 rounded-sm bg-primary text-white font-mono text-label uppercase tracking-widest disabled:opacity-50">
            {busy ? '…' : t('manage.save')}
          </button>
        </>
      }
    >
      <Field label={t('manage.staff.col.name')} value={draft.name} onChange={(v) => onChange({ ...draft, name: v })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('manage.staff.year')} type="number" value={String(draft.year)} onChange={(v) => onChange({ ...draft, year: Number(v) })} />
        <SelectField
          label={t('manage.staff.col.department')}
          value={draft.departmentSlug}
          options={departments.map((d) => ({ value: d.slug, label: d.slug }))}
          onChange={(v) => onChange({ ...draft, departmentSlug: v })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('manage.staff.roleEs')} value={draft.roleEs} onChange={(v) => onChange({ ...draft, roleEs: v })} />
        <Field label={t('manage.staff.roleEn')} value={draft.roleEn} onChange={(v) => onChange({ ...draft, roleEn: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('manage.staff.col.order')} type="number" value={String(draft.displayOrder)} onChange={(v) => onChange({ ...draft, displayOrder: Number(v) })} />
        <Field label={t('manage.staff.email')} value={draft.email ?? ''} onChange={(v) => onChange({ ...draft, email: v || null })} />
      </div>
      <Field label={t('manage.staff.photoUrl')} value={draft.photoUrl ?? ''} onChange={(v) => onChange({ ...draft, photoUrl: v || null })} />
      <Field label={t('manage.staff.linkedinUrl')} value={draft.linkedinUrl ?? ''} onChange={(v) => onChange({ ...draft, linkedinUrl: v || null })} />
    </Modal>
  )
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm"
      />
    </label>
  )
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
