import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStaffMembers, useStaffYears } from '../../hooks/useContent'
import type { StaffMember } from '../../api/content'

const PLACEHOLDER_COUNT = 8

function MemberCard({ member, lang }: { member: StaffMember; lang: 'es' | 'en' }) {
  const initials = member.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex flex-col items-center gap-3 p-5 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] shadow-card text-center">
      {member.photoUrl ? (
        <img
          src={member.photoUrl}
          alt={member.name}
          className="w-14 h-14 rounded-full object-cover"
        />
      ) : (
        <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center flex-shrink-0">
          <span className="font-display font-bold text-primary text-h5 leading-none">{initials}</span>
        </div>
      )}
      <div>
        <p className="font-body font-semibold text-body-sm text-ink-primary dark:text-[#f4f4f5]">
          {member.name}
        </p>
        <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa] mt-0.5">
          {lang === 'es' ? member.roleEs : member.roleEn}
        </p>
      </div>
      {member.linkedinUrl && (
        <a
          href={member.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`LinkedIn de ${member.name}`}
          className="text-ink-secondary dark:text-[#a1a1aa] hover:text-primary transition-colors duration-150"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
            <rect x="2" y="9" width="4" height="12" />
            <circle cx="4" cy="4" r="2" />
          </svg>
        </a>
      )}
    </div>
  )
}

export default function StaffSection() {
  const { t, i18n } = useTranslation()
  const lang: 'es' | 'en' = i18n.language === 'en' ? 'en' : 'es'

  const { data: years } = useStaffYears()
  const yearList = years ?? []
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  useEffect(() => {
    if (selectedYear == null && yearList.length > 0) setSelectedYear(yearList[0])
  }, [yearList, selectedYear])

  const { data: members, loading: loadingMembers } = useStaffMembers(selectedYear)
  const memberList = members ?? []

  const grouped = useMemo(() => {
    // Preserve API order (department slug ASC, then displayOrder, then name).
    const out = new Map<string, StaffMember[]>()
    for (const m of memberList) {
      if (!out.has(m.departmentSlug)) out.set(m.departmentSlug, [])
      out.get(m.departmentSlug)!.push(m)
    }
    return out
  }, [memberList])

  const hasAnyMember = memberList.length > 0

  return (
    <section className="py-section-mobile lg:py-section" aria-labelledby="staff-heading">
      <div className="container-content">
        <div className="mb-8">
          <h2 id="staff-heading" className="font-display font-bold text-h3 text-ink-primary dark:text-[#f4f4f5] mb-2">
            {t('staff.sectionTitle')}
          </h2>
          <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa]">
            {t('staff.sectionSubtitle')}
          </p>
        </div>

        {yearList.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8" role="group" aria-label={t('staff.yearLabel')}>
            {yearList.map(year => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                aria-pressed={selectedYear === year}
                className={`px-4 py-1.5 rounded-full font-mono text-label uppercase tracking-widest transition-colors duration-150 ${
                  selectedYear === year
                    ? 'bg-primary dark:bg-[#7FA1D4] text-white dark:text-[#0f1f38]'
                    : 'border border-border dark:border-[#3f3f46] text-ink-secondary dark:text-[#a1a1aa] hover:border-primary hover:text-primary'
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        )}

        {!loadingMembers && !hasAnyMember && (
          <div className="flex flex-col items-center gap-4 py-12 px-6 mb-8 rounded-card border border-dashed border-border dark:border-[#3f3f46] text-center">
            <div className="w-12 h-12 rounded-full bg-primary-50 dark:bg-primary-900 flex items-center justify-center" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2.5" />
              </svg>
            </div>
            <div>
              <p className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5]">
                {t('staff.comingSoon')}
              </p>
              <p className="font-body text-body-sm text-ink-secondary dark:text-[#a1a1aa] mt-1">
                {t('staff.comingSoonMessage')}
              </p>
            </div>
          </div>
        )}

        {hasAnyMember ? (
          Array.from(grouped.entries()).map(([deptSlug, list]) => (
            <div key={deptSlug} className="mb-10 last:mb-0">
              <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5] mb-4">
                {t(`departments.${deptSlug}.name`)}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {list.map(member => (
                  <MemberCard key={member.id} member={member} lang={lang} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" aria-hidden="true">
            {Array.from({ length: PLACEHOLDER_COUNT }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col items-center gap-3 p-5 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a]"
              >
                <div className="w-14 h-14 rounded-full skeleton" />
                <div className="w-24 h-3.5 rounded skeleton" />
                <div className="w-16 h-2.5 rounded skeleton" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
