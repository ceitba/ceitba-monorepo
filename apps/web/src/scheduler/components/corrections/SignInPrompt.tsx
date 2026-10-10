import { useTranslation } from 'react-i18next'
import { useBeginSignIn } from '../../context/signInContext'
import { Button } from '@/components/ui'

// Short explanation + Google sign-in that comes back to this same page
// (career and plan included, they live in the path and query; inside the
// career workspace the unsaved workspace comes back too).
export default function SignInPrompt({ message, compact = false }: { message: string; compact?: boolean }) {
  const { t } = useTranslation()
  const beginSignIn = useBeginSignIn()
  return (
    <div className={`flex ${compact ? 'flex-wrap items-center gap-x-3 gap-y-1' : 'flex-col gap-3'}`}>
      <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{message}</p>
      <Button
        onClick={beginSignIn}
        variant={compact ? 'outline' : 'primary'}
        size={compact ? 'sm' : 'md'}
        className="self-start"
      >
        {t('corrections.signIn')}
      </Button>
    </div>
  )
}
