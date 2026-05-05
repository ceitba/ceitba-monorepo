import { useEffect, useMemo, useState } from 'react'
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

  useEffect(() => { fetchStaffYears().then(setYears).catch(() => setYears([])) }, [])
  useEffect(() => { reloadMembers() }, [year]) // eslint-disable-line

  function reloadMembers() {
    fetchStaffMembers(year).then(setMembers).catch((e: Error) => setError(e.message))
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

  async function remove(id: string) {
    if (!confirm(t('manage.staff.confirmDelete'))) return
    setError(null)
    try {
      await deleteStaffMember(id)
      reloadMembers()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
          {t('manage.staff.year')}
        </label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-1.5 font-body text-body-sm rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a]"
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
        <p className="px-3 py-2 rounded-sm bg-red-50 text-red-700 font-body text-body-sm border border-red-200">{error}</p>
      )}

      {Array.from(grouped.entries()).map(([deptSlug, list]) => (
        <section key={deptSlug}>
          <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5] mb-3">
            {t(`departments.${deptSlug}.name`, { defaultValue: deptSlug })}
          </h3>
          <div className="overflow-x-auto rounded-card border border-border dark:border-[#3f3f46]">
            <table className="w-full font-body text-body-sm">
              <thead className="bg-page-bg dark:bg-[#18181b]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.name')}</th>
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.role')}</th>
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.staff.col.order')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="border-t border-border dark:border-[#3f3f46]">
                    <td className="px-3 py-2">{m.name}</td>
                    <td className="px-3 py-2">{m.roleEs} / {m.roleEn}</td>
                    <td className="px-3 py-2">{m.displayOrder}</td>
                    <td className="px-3 py-2 flex gap-2 justify-end">
                      <button onClick={() => setEditing(m)} className="text-primary font-mono text-label uppercase tracking-widest">{t('manage.edit')}</button>
                      <button onClick={() => remove(m.id)} className="text-red-600 font-mono text-label uppercase tracking-widest">{t('manage.delete')}</button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-secondary dark:text-[#a1a1aa]">{t('manage.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {grouped.size === 0 && (
        <p className="text-ink-secondary dark:text-[#a1a1aa] font-body text-body-sm">{t('manage.staff.noneForYear')}</p>
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-[#27272a] rounded-card border border-border dark:border-[#3f3f46] p-6 flex flex-col gap-4">
        <h3 className="font-display font-bold text-h4">{draft.id ? t('manage.staff.editTitle') : t('manage.staff.addTitle')}</h3>
        <Field label={t('manage.staff.col.name')} value={draft.name} onChange={(v) => onChange({ ...draft, name: v })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Año" type="number" value={String(draft.year)} onChange={(v) => onChange({ ...draft, year: Number(v) })} />
          <SelectField
            label={t('manage.staff.col.department')}
            value={draft.departmentSlug}
            options={departments.map((d) => ({ value: d.slug, label: d.slug }))}
            onChange={(v) => onChange({ ...draft, departmentSlug: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role (ES)" value={draft.roleEs} onChange={(v) => onChange({ ...draft, roleEs: v })} />
          <Field label="Role (EN)" value={draft.roleEn} onChange={(v) => onChange({ ...draft, roleEn: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('manage.staff.col.order')} type="number" value={String(draft.displayOrder)} onChange={(v) => onChange({ ...draft, displayOrder: Number(v) })} />
          <Field label="Email" value={draft.email ?? ''} onChange={(v) => onChange({ ...draft, email: v || null })} />
        </div>
        <Field label="Photo URL" value={draft.photoUrl ?? ''} onChange={(v) => onChange({ ...draft, photoUrl: v || null })} />
        <Field label="LinkedIn URL" value={draft.linkedinUrl ?? ''} onChange={(v) => onChange({ ...draft, linkedinUrl: v || null })} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 font-mono text-label uppercase tracking-widest text-ink-secondary">{t('manage.cancel')}</button>
          <button type="button" disabled={busy} onClick={onSave} className="px-3 py-1.5 rounded-sm bg-primary text-white font-mono text-label uppercase tracking-widest disabled:opacity-50">
            {busy ? '…' : t('manage.save')}
          </button>
        </div>
      </div>
    </div>
  )
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
