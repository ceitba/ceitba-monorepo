import { Routes, Route, Navigate } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import i18n from './i18nScheduler'
import HomePage from './pages/HomePage'
import CareerPage from './pages/CareerPage'
import SavedSchedulesPage from './pages/SavedSchedulesPage'
import ComparisonPage from './pages/ComparisonPage'
import SharePage from './pages/SharePage'
import CorrectionNotices from './components/corrections/CorrectionNotices'
import { SCHEDULER_BASE } from './paths'

// The "Combinador de Horarios", mounted at /scheduler/* by App.tsx and
// loaded on demand. Route paths here are relative to /scheduler; its strings
// live in the "scheduler" i18n namespace.
export default function SchedulerApp() {
  useDocumentTitle('CEITBA | Combinador de Horarios')
  return (
    <I18nextProvider i18n={i18n} defaultNS="scheduler">
      <CorrectionNotices />
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="saved" element={<SavedSchedulesPage />} />
        <Route path="compare" element={<ComparisonPage />} />
        <Route path="share/:token" element={<SharePage />} />
        <Route path=":career" element={<CareerPage />} />
        <Route path="*" element={<Navigate to={SCHEDULER_BASE} replace />} />
      </Routes>
    </I18nextProvider>
  )
}
