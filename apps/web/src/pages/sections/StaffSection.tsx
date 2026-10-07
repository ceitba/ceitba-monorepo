import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStaffMembers, useStaffYears } from '../../hooks/useContent'
import type { StaffMember } from '../../api/content'
import { EmptyState, ErrorState, LoadingRegion, Skeleton, ToggleGroup } from '../../components/ui'
import { safeHttpUrl } from '../../utils/url'

const PLACEHOLDER_COUNT = 8

function MemberCard({ member, lang }: { member: StaffMember; lang: 'es' | 'en' }) {
  const { t } = useTranslation()
  const initials = member.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const photoUrl = safeHttpUrl(member.photoUrl)
  const linkedinUrl = safeHttpUrl(member.linkedinUrl)

  return (
    <div className="flex flex-col items-center gap-3 p-5 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card text-center">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={member.name}
          className="w-14 h-14 rounded-full object-cover"
        />
      ) : (
        <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center flex-shrink-0">
          <span className="font-display font-bold text-primary dark:text-primary-200 text-h5 leading-none">{initials}</span>
        </div>
      )}
      <div>
        <p className="font-body font-semibold text-body-sm text-ink-primary dark:text-night-text">
          {member.name}
        </p>
        <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted mt-0.5">
          {lang === 'es' ? member.roleEs : member.roleEn}
        </p>
      </div>
      {linkedinUrl && (
        <a
          href={linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('staff.linkedinAria', { name: member.name })}
          className="inline-flex items-center justify-center w-11 h-11 rounded-sm text-ink-secondary dark:text-night-muted hover:text-primary transition-colors duration-150"
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

  const { data: years, loading: loadingYears, error: yearsError, reload: reloadYears } = useStaffYears()
  const yearList = useMemo(() => years ?? [], [years])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  useEffect(() => {
    if (selectedYear == null && yearList.length > 0) setSelectedYear(yearList[0])
  }, [yearList, selectedYear])

  const { data: members, loading: membersLoading, error: membersError, reload: reloadMembers } = useStaffMembers(selectedYear)
  const memberList = useMemo(() => members ?? [], [members])
  // useStaffMembers(null) resolves [] immediately, so until the years list
  // has loaded and a year is selected we're still loading, not "empty".
  const loadingMembers = loadingYears || (selectedYear == null && yearList.length > 0) || membersLoading
  const failed = !loadingMembers && (yearsError != null || membersError != null)
  const retry = () => { void (yearsError != null ? reloadYears() : reloadMembers()) }

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
          <h2 id="staff-heading" className="font-display font-bold text-h3 text-ink-primary dark:text-night-text mb-2">
            {t('staff.sectionTitle')}
          </h2>
          <p className="font-body text-body text-ink-secondary dark:text-night-muted">
            {t('staff.sectionSubtitle')}
          </p>
        </div>

        {yearList.length > 0 && selectedYear != null && (
          <ToggleGroup
            className="mb-8"
            label={t('staff.yearLabel')}
            value={selectedYear}
            onChange={setSelectedYear}
            options={yearList.map((year) => ({ value: year, label: year }))}
          />
        )}

        {failed ? (
          <ErrorState onRetry={retry} />
        ) : !loadingMembers && !hasAnyMember ? (
          <EmptyState title={t('staff.comingSoon')} body={t('staff.comingSoonMessage')} />
        ) : hasAnyMember ? (
          Array.from(grouped.entries()).map(([deptSlug, list]) => (
            <div key={deptSlug} className="mb-10 last:mb-0 animate-fade-in">
              <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-night-text mb-4">
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
          <LoadingRegion className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: PLACEHOLDER_COUNT }).map((_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="flex flex-col items-center gap-3 p-5 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface"
              >
                <Skeleton className="w-14 h-14 !rounded-full" />
                <Skeleton className="w-24 h-3.5" />
                <Skeleton className="w-16 h-2.5" />
              </div>
            ))}
          </LoadingRegion>
        )}
      </div>
    </section>
  )
}
