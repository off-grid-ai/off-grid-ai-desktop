import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { BorderBeam } from './ui/border-beam'
import { GridBackdrop } from './ui/grid-backdrop'
import { cn } from '@renderer/lib/utils'
import { Shield, Eye, Check, X, ArrowsClockwise as RefreshCw, Cpu } from '@phosphor-icons/react'
import { SetupPanel } from './setup/SetupPanel'

interface PermissionGateProps {
  children: React.ReactNode
}

export function PermissionGate({ children }: PermissionGateProps) {
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const [modelStatus, setModelStatus] = useState<{ downloaded: boolean; modelsDir: string } | null>(
    null
  )
  // Pro setup is NON-blocking: users go straight into the shell to look around.
  // The detailed setup screen opens on demand; a slim nudge can be dismissed.
  const [showSetup, setShowSetup] = useState(false)
  const [setupDismissed, setSetupDismissed] = useState(false)

  // Capture permissions (Accessibility + Screen Recording) are only needed by the
  // Pro "sees" layer. The free build runs chat/projects/models and gates on the
  // model alone.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isPro = !!(window as any).api?.isPro
  const permsOk = isPro ? (permissionStatus?.allGranted ?? false) : true

  const checkPermissions = useCallback(async () => {
    try {
      const status = await window.api.getPermissionStatus()
      console.log('Permission status:', status)
      setPermissionStatus(status)
      setIsChecking(false)
      return status.allGranted
    } catch (e) {
      console.error('Failed to check permissions:', e)
      setIsChecking(false)
      return false
    }
  }, [])

  const checkModelStatus = useCallback(async () => {
    try {
      const status = await window.api.checkModelStatus()
      console.log('Model status:', status)
      setModelStatus(status)
      return status.downloaded
    } catch (e) {
      console.error('Failed to check model status:', e)
      return false
    }
  }, [])

  // Initial check
  useEffect(() => {
    checkPermissions()
    checkModelStatus()
  }, [checkPermissions, checkModelStatus])

  // Poll for permission changes when permissions are not granted
  useEffect(() => {
    if (permsOk && modelStatus?.downloaded) return

    const interval = setInterval(() => {
      if (isPro) checkPermissions()
      checkModelStatus()
    }, 2000)

    return () => clearInterval(interval)
  }, [permsOk, isPro, modelStatus?.downloaded, checkPermissions, checkModelStatus])

  const handleOpenAccessibilitySettings = async () => {
    try {
      await window.api.openAccessibilitySettings()
    } catch (e) {
      console.error('Failed to open accessibility settings:', e)
    }
  }

  const handleOpenScreenRecordingSettings = async () => {
    try {
      await window.api.openScreenRecordingSettings()
    } catch (e) {
      console.error('Failed to open screen recording settings:', e)
    }
  }

  const handleRefresh = () => {
    setIsChecking(true)
    checkPermissions()
    checkModelStatus()
  }

  // Loading state
  if (isChecking && !permissionStatus) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center fixed inset-0">
        <GridBackdrop className="z-0" />
        <motion.div
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative z-10 text-center"
        >
          <div className="w-8 h-8 mx-auto mb-4 border-2 border-neutral-700 border-t-neutral-400 rounded-full animate-spin" />
          <p className="text-neutral-500 text-sm">Checking permissions</p>
        </motion.div>
      </div>
    )
  }

  // Both tiers flow through the same NON-blocking path. "Ready" = a model is
  // present (Pro also needs capture permissions). Free has permsOk=true, so for
  // free this is just "has a model". Either way it's a dismissible nudge, never a
  // wall — so free users also get the "Configure for me" prompt when they have no
  // model yet (the most useful first-run action).
  const ready = permsOk && !!modelStatus?.downloaded

  // Default (NON-blocking): drop straight into the shell so people can look around.
  // Show a slim, dismissible nudge when capture perms or a model are still missing.
  if (ready || !showSetup) {
    return (
      <>
        {children}
        {!ready && !setupDismissed && (
          <SetupNudge
            missingModel={!modelStatus?.downloaded}
            onOpen={() => setShowSetup(true)}
            onDismiss={() => setSetupDismissed(true)}
          />
        )}
      </>
    )
  }

  // Detailed setup screen — opened on demand from the nudge (no longer a hard wall).
  return (
    <div className="h-screen w-screen bg-neutral-950 fixed inset-0 overflow-hidden">
      <GridBackdrop className="z-0" />
      <button
        onClick={() => setShowSetup(false)}
        className="absolute left-4 top-4 z-20 flex items-center gap-1 text-sm text-neutral-400 transition-colors hover:text-white"
      >
        ← Back to app
      </button>

      <div className="relative z-10 h-full w-full flex flex-col items-center overflow-y-auto py-12 px-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="w-full max-w-3xl my-auto"
        >
          {/* Icon */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex justify-center mb-8"
          >
            <div className="w-16 h-16 rounded-2xl bg-neutral-900/80 border border-neutral-800 flex items-center justify-center backdrop-blur-xl">
              <Cpu className="w-7 h-7 text-green-500" />
            </div>
          </motion.div>

          {/* Title */}
          <h1 className="text-center text-3xl md:text-4xl font-light tracking-tight text-white mb-3">
            Set up your local AI
          </h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="text-center text-neutral-500 text-sm mb-10 max-w-xs mx-auto leading-relaxed"
          >
            {isPro
              ? 'Grant permissions and download a model to get started. Everything runs locally on your device.'
              : 'Download a model to get started. Everything runs locally on your device — no cloud, no account.'}
          </motion.p>

          {/* The model: one-click "Configure for me" + manual browse (shared with
              Settings). On success it flips modelStatus and the gate clears. */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="mb-8"
          >
            <SetupPanel hideHealth onConfigured={checkModelStatus} />
            <div className="mt-3 text-center">
              <button
                onClick={() => {
                  // Drop into the real in-app Models screen (with the left nav). The
                  // app shell (already mounted behind this gate) listens for og:navigate
                  // and switches view — replaceState alone wouldn't re-derive it. Keep
                  // the URL in sync, then dismiss the gate.
                  window.dispatchEvent(new CustomEvent('og:navigate', { detail: 'models' }))
                  window.history.replaceState(null, '', '/models')
                  setSetupDismissed(true)
                  setShowSetup(false)
                }}
                className="text-xs text-neutral-500 underline-offset-2 transition-colors hover:text-neutral-300 hover:underline"
              >
                or browse &amp; pick a model yourself
              </button>
            </div>
          </motion.div>

          {/* What you get — gives the screen substance and sells the local stack. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.75, duration: 0.4 }}
            className="mb-2 flex flex-col items-center gap-2"
          >
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-neutral-400">
              {['Chat', 'Vision', 'Images', 'Voice', 'Speech'].map((c) => (
                <span key={c} className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-green-500" />
                  {c}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-neutral-600">
              One app · every open model · all on your device
            </p>
          </motion.div>

          {/* Capture permissions — Pro only. */}
          {isPro && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="mb-8"
            >
              <div className="mb-3 text-[10px] font-medium uppercase tracking-widest text-neutral-600">
                Capture permissions
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <PermissionCard
                  title="Accessibility"
                  description="Read text from AI chat windows"
                  icon={<Eye className="w-5 h-5" />}
                  granted={permissionStatus?.accessibility ?? false}
                  onOpenSettings={handleOpenAccessibilitySettings}
                  delay={0.85}
                />
                <PermissionCard
                  title="Screen Recording"
                  description="Capture visual context for OCR"
                  icon={<Shield className="w-5 h-5" />}
                  granted={permissionStatus?.screenRecording ?? false}
                  onOpenSettings={handleOpenScreenRecordingSettings}
                  delay={0.9}
                />
              </div>
            </motion.div>
          )}

          {/* "Check Again" + auto-checking only make sense for Pro capture permissions
              (you grant them in System Settings, then re-poll). For a model-only setup
              there's nothing to re-check — Configure handles it. */}
          {isPro && (
            <>
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                onClick={handleRefresh}
                disabled={isChecking}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className={cn(
                  'w-full py-3 rounded-xl font-medium transition-all',
                  'bg-neutral-900/80 border border-neutral-800 text-neutral-300',
                  'hover:bg-neutral-800 hover:border-neutral-700 hover:text-white',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'flex items-center justify-center gap-2'
                )}
              >
                <RefreshCw className={cn('w-4 h-4', isChecking && 'animate-spin')} />
                {isChecking ? 'Checking' : 'Check permissions again'}
              </motion.button>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.1 }}
                className="flex items-center justify-center gap-2 mt-4"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-neutral-700 animate-pulse" />
                <span className="text-[10px] text-neutral-600 uppercase tracking-widest">
                  Auto-checking
                </span>
              </motion.div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  )
}

// Slim, dismissible setup nudge shown over the shell when Pro setup is incomplete.
// Non-blocking: people can explore the whole app and finish setup whenever.
function SetupNudge({
  missingModel,
  onOpen,
  onDismiss
}: {
  missingModel: boolean
  onOpen: () => void
  onDismiss: () => void
}) {
  // Model-first wording. Missing a model is the thing that actually blocks you, and
  // "Configure for me" handles it in one click — so lead with that for both tiers.
  // Capture permissions (Pro-only) are the secondary, optional step.
  const title = missingModel ? 'Set up your local AI' : 'Finish setting up capture'
  const detail = missingModel
    ? 'Pick a model yourself, or let Off Grid configure one for your Mac.'
    : 'Grant screen & accessibility access so Off Grid can see & remember.'
  const cta = missingModel ? 'Configure' : 'Set up'
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="fixed bottom-14 right-4 z-50 flex items-center gap-3 rounded-xl border border-green-500/30 bg-neutral-900/95 px-4 py-3 shadow-xl backdrop-blur-xl"
    >
      <Cpu className="h-4 w-4 shrink-0 text-green-500" />
      <div className="text-xs leading-tight">
        <div className="font-medium text-white">{title}</div>
        <div className="text-neutral-500">{detail}</div>
      </div>
      <button
        onClick={onOpen}
        className="ml-1 whitespace-nowrap rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-500"
      >
        {cta}
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded-md p-1 text-neutral-500 transition-colors hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  )
}

interface PermissionCardProps {
  title: string
  description: string
  icon: React.ReactNode
  granted: boolean
  onOpenSettings: () => void
  delay?: number
}

function PermissionCard({
  title,
  description,
  icon,
  granted,
  onOpenSettings,
  delay = 0
}: PermissionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ scale: 1.01 }}
      className={cn(
        'relative rounded-xl border p-4 transition-all duration-300 overflow-hidden',
        granted
          ? 'bg-neutral-900/60 border-neutral-700'
          : 'bg-neutral-900/40 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/60'
      )}
    >
      {granted && <BorderBeam size={200} duration={10} borderWidth={1.5} />}

      {/* Vertical column card (desktop grid) */}
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center justify-between">
          <div
            className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300',
              granted
                ? 'bg-neutral-800 border-neutral-700 text-neutral-300'
                : 'bg-neutral-800/60 border-neutral-800 text-neutral-500'
            )}
          >
            {icon}
          </div>
          {granted && (
            <span className="text-[10px] text-neutral-500 uppercase tracking-widest">Enabled</span>
          )}
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-medium text-white text-sm">{title}</h3>
            <div
              className={cn(
                'w-4 h-4 rounded-full flex items-center justify-center transition-all duration-300',
                granted ? 'bg-neutral-700' : 'bg-neutral-800/60'
              )}
            >
              {granted ? (
                <Check className="w-2.5 h-2.5 text-neutral-300" />
              ) : (
                <X className="w-2.5 h-2.5 text-neutral-600" />
              )}
            </div>
          </div>
          <p className="text-xs text-neutral-500">{description}</p>
        </div>

        {!granted && (
          <button
            onClick={onOpenSettings}
            className={cn(
              'w-full px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200',
              'bg-neutral-800 border border-neutral-700 text-neutral-300',
              'hover:bg-neutral-700 hover:text-white'
            )}
          >
            Open Settings
          </button>
        )}
      </div>
    </motion.div>
  )
}
