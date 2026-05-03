import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface StaffMember {
  name: string
  role: { es: string; en: string }
  photo: string | null
  linkedin: string | null
  email: string | null
}

interface StaffYear {
  year: number
  departments: Record<string, { members: StaffMember[] }>
}

// Auto-discovers all YYYY.json files in src/data/staff/ — adding a new year
// file is all that's needed to make it appear as a tab.
const modules = import.meta.glob('../../data/staff/[0-9]*.json', { eager: true })

const staffByYear: Record<number, StaffYear> = {}
for (const [, mod] of Object.entries(modules)) {
  const data = mod as StaffYear
  if (data?.year) staffByYear[data.year] = data
}

const YEARS = Object.keys(staffByYear).map(Number).sort((a, b) => b - a)
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
      {member.photo ? (
        <img
          src={member.photo}
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
          {member.role[lang]}
        </p>
      </div>
      {member.linkedin && (
        <a
          href={member.linkedin}
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
  const lang = i18n.language === 'en' ? 'en' : 'es'
  const [selectedYear, setSelectedYear] = useState<number>(YEARS[0] ?? new Date().getFullYear())

  const yearData = staffByYear[selectedYear]
  const hasAnyMember = yearData
    ? Object.values(yearData.departments).some(d => d.members.length > 0)
    : false

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

        {/* Year chips */}
        {YEARS.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8" role="group" aria-label={t('staff.yearLabel')}>
            {YEARS.map(year => (
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

        {/* Coming-soon banner */}
        {!hasAnyMember && (
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

        {/* Member grid — grouped by department */}
        {hasAnyMember
          ? Object.entries(yearData.departments).map(([deptId, dept]) =>
              dept.members.length > 0 ? (
                <div key={deptId} className="mb-10 last:mb-0">
                  <h3 className="font-display font-bold text-h5 text-ink-primary dark:text-[#f4f4f5] mb-4">
                    {t(`departments.${deptId}.name`)}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {dept.members.map(member => (
                      <MemberCard key={member.name} member={member} lang={lang} />
                    ))}
                  </div>
                </div>
              ) : null
            )
          : (
            /* Skeleton placeholder grid */
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
          )
        }
      </div>
    </section>
  )
}
