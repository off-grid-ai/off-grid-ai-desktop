import { useState, useEffect } from 'react';
import { motion, AnimatePresence, stagger, useAnimate } from 'motion/react';
import { LampContainer } from './ui/lamp';
import { OrbitingCircles } from './ui/orbiting-circles';
import { GridBackdrop } from './ui/grid-backdrop';
import { cn } from '@renderer/lib/utils';
import logo from '@/assets/logo.png';
import {
  ArrowRight,
  Check,
  ChatCircle,
  Eye,
  Image as ImageIcon,
  Microphone,
  SpeakerHigh,
  FolderOpen,
  CalendarBlank,
  CheckSquare,
  Rewind,
  MagnifyingGlass,
  Graph,
  ShieldCheck,
  Waveform,
} from '@phosphor-icons/react';

// Word-by-word blur-in, matching the brand's terminal feel.
function TextGenerate({ words, className, delay = 0 }: { words: string; className?: string; delay?: number }) {
  const [scope, animate] = useAnimate();
  const wordsArray = words.split(' ');
  useEffect(() => {
    const timer = setTimeout(() => {
      animate('span', { opacity: 1, filter: 'blur(0px)' }, { duration: 0.4, delay: stagger(0.08) });
    }, delay * 1000);
    return () => clearTimeout(timer);
  }, [animate, delay]);
  return (
    <motion.div ref={scope} className={cn('inline', className)}>
      {wordsArray.map((word, idx) => (
        <motion.span key={word + idx} className="opacity-0 inline-block" style={{ filter: 'blur(8px)' }}>
          {word}
          {idx < wordsArray.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </motion.div>
  );
}

function AnimatedNumber({ value, delay = 0 }: { value: number; delay?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      const steps = 30;
      const increment = value / steps;
      let current = 0;
      const interval = setInterval(() => {
        current += increment;
        if (current >= value) { setDisplayValue(value); clearInterval(interval); }
        else setDisplayValue(Math.floor(current));
      }, 1000 / steps);
      return () => clearInterval(interval);
    }, delay * 1000);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return <span>{displayValue.toLocaleString()}</span>;
}

interface OnboardingProps {
  onComplete: () => void;
}

const steps = [{ id: 'welcome' }, { id: 'capabilities' }, { id: 'pro' }, { id: 'private' }];

const ORBIT = [
  { icon: ChatCircle, label: 'Chat' },
  { icon: Eye, label: 'Vision' },
  { icon: ImageIcon, label: 'Image' },
  { icon: Microphone, label: 'Voice' },
  { icon: SpeakerHigh, label: 'Speech' },
  { icon: FolderOpen, label: 'Projects' },
];

// The Pro layer — every capability described by what it does, on-device.
const PRO_GRID = [
  { icon: Rewind, label: 'Replay', line: 'Rewinds your screen history, so the doc or number you saw last week is a scrub away, not a hunt.' },
  { icon: Microphone, label: 'Meetings', line: 'Records and transcribes your calls on-device, so you walk out with the decisions and to-dos already written.' },
  { icon: CheckSquare, label: 'To-dos', line: 'Pulls the commitments out of your day and queues the next step, so nothing you promised quietly slips.' },
  { icon: MagnifyingGlass, label: 'Memory', line: 'One search across everything you have seen, said, and saved, so you never lose a thing twice.' },
  { icon: Graph, label: 'Entities', line: 'Builds a record of every person and project on its own, so you walk into any call knowing where you left off.' },
  { icon: CalendarBlank, label: 'Day', line: 'Lays out your day from your work and the calendars you connect, so you start oriented instead of scrambling.' },
  { icon: ShieldCheck, label: 'Vault', line: 'Encrypts passwords, keys, and secret files with a key that never leaves this Mac, so they stay yours alone.' },
  { icon: Waveform, label: 'Voice', line: 'Hold Option+Space and talk - transcribed locally and pasted at your cursor, so you type with your voice anywhere.' },
];

export function Onboarding({ onComplete }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = (): void => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      localStorage.setItem('onboarding_completed', 'true');
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-neutral-950 font-mono">
      <AnimatePresence mode="wait">
        {/* Step 0 — Welcome */}
        {currentStep === 0 && (
          <motion.div key="step-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full w-full">
            <LampContainer className="min-h-screen bg-neutral-950">
              <motion.div
                initial={{ opacity: 0.5, y: 100 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8, ease: 'easeInOut' }}
                className="text-center"
              >
                <h1 className="bg-gradient-to-br from-white to-neutral-400 py-4 bg-clip-text text-4xl font-semibold tracking-tight text-transparent md:text-7xl">
                  Off Grid AI
                </h1>
                <p className="mx-auto mt-4 max-w-xl text-lg text-neutral-400">
                  Private AI that runs on <span className="text-green-400">your</span> machine.
                  Your models, your data — <span className="text-green-400">no cloud, no accounts</span>.
                </p>
              </motion.div>
            </LampContainer>
          </motion.div>
        )}

        {/* Step 1 — One app, every model, all local */}
        {currentStep === 1 && (
          <motion.div key="step-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative h-full w-full bg-neutral-950">
            <GridBackdrop className="opacity-70" />
            <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
              <div className="mb-6 text-center">
                <TextGenerate words="One app. Every model. On your Mac." className="text-3xl font-semibold tracking-tight text-white md:text-5xl" delay={0} />
                <div className="mt-4">
                  <TextGenerate words="Download open models and chat, see, draw, listen, and speak — all on-device." className="text-neutral-400" delay={0.4} />
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6, duration: 0.6 }}
                className="relative flex h-[400px] w-full max-w-[500px] items-center justify-center overflow-hidden"
              >
                <div className="absolute z-10 flex h-24 w-24 items-center justify-center rounded-2xl border border-green-500/30 bg-neutral-900">
                  <img src={logo} alt="Off Grid" className="h-12 w-12 rounded-lg" />
                </div>
                <OrbitingCircles radius={110} duration={26} iconSize={56}>
                  {ORBIT.slice(0, 3).map(({ icon: Icon, label }) => (
                    <div key={label} className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-neutral-800 bg-neutral-900">
                      <Icon className="h-5 w-5 text-green-400" weight="regular" />
                      <span className="text-[8px] text-neutral-500">{label}</span>
                    </div>
                  ))}
                </OrbitingCircles>
                <OrbitingCircles radius={180} duration={32} reverse iconSize={56}>
                  {ORBIT.slice(3).map(({ icon: Icon, label }) => (
                    <div key={label} className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-neutral-800 bg-neutral-900">
                      <Icon className="h-5 w-5 text-green-400" weight="regular" />
                      <span className="text-[8px] text-neutral-500">{label}</span>
                    </div>
                  ))}
                </OrbitingCircles>
              </motion.div>

              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-4 text-xs text-neutral-600">
                Text · Vision · Image · Voice · Speech — one local gateway
              </motion.p>
            </div>
          </motion.div>
        )}

        {/* Step 2 — The Pro layer: it starts remembering */}
        {currentStep === 2 && (
          <motion.div key="step-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative flex h-full w-full flex-col items-center justify-center bg-neutral-950 px-6">
            <GridBackdrop className="opacity-70" />
            <div className="relative z-10 mx-auto max-w-5xl">
              <div className="mb-2 text-center">
                <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-green-400">Off Grid Pro · live now</span>
              </div>
              <div className="mb-3 text-center">
                <TextGenerate words="Then it starts remembering." className="text-3xl font-semibold tracking-tight text-white md:text-4xl" delay={0} />
              </div>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mx-auto mb-10 max-w-2xl text-center text-sm text-neutral-400">
                The free app runs models. Pro adds the always-on layer: turn on capture and Off Grid keeps a private record of what you see and do, then acts on it with your approval. Every one runs on-device. Nothing is uploaded.
              </motion.p>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {PRO_GRID.map(({ icon: Icon, label, line }, i) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * 0.06, duration: 0.4 }}
                    className="group relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 transition-colors hover:border-green-500/30"
                  >
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 transition-colors group-hover:border-green-500/30 group-hover:bg-green-500/10">
                      <Icon className="h-4 w-4 text-neutral-400 transition-colors group-hover:text-green-400" weight="regular" />
                    </div>
                    <h3 className="mb-1 text-[13px] font-medium uppercase tracking-wide text-white">{label}</h3>
                    <p className="text-xs leading-relaxed text-neutral-500">{line}</p>
                  </motion.div>
                ))}
              </div>

              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-8 text-center text-xs text-neutral-600">
                Pro is live now. $49/year or $69 once - one license across up to 5 devices.
              </motion.p>
            </div>
          </motion.div>
        )}

        {/* Step 3 — Private close */}
        {currentStep === 3 && (
          <motion.div key="step-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative flex h-full w-full flex-col items-center justify-center bg-neutral-950 px-6">
            <GridBackdrop className="opacity-70" />
            <div className="relative z-10 mx-auto max-w-2xl text-center">
              <TextGenerate words="It all runs in your Mac's RAM." className="text-3xl font-semibold tracking-tight text-white md:text-5xl" delay={0} />
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mx-auto mt-5 max-w-xl text-neutral-400">
                No account, no API key, no telemetry. Inference happens on your CPU and GPU. Turn off wifi and it keeps working. You can verify it yourself.
              </motion.p>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1, duration: 0.5 }} className="mt-12 flex items-center justify-center gap-12">
                <div className="text-center">
                  <div className="text-3xl font-light text-green-400"><AnimatedNumber value={100} delay={1.2} />%</div>
                  <div className="mt-1 text-xs uppercase tracking-wider text-neutral-600">Local</div>
                </div>
                <div className="h-8 w-px bg-neutral-800" />
                <div className="text-center">
                  <div className="text-3xl font-light text-white"><AnimatedNumber value={0} delay={1.3} /></div>
                  <div className="mt-1 text-xs uppercase tracking-wider text-neutral-600">Cloud</div>
                </div>
                <div className="h-8 w-px bg-neutral-800" />
                <div className="text-center">
                  <div className="text-3xl font-light tabular-nums text-white">∞</div>
                  <div className="mt-1 text-xs uppercase tracking-wider text-neutral-600">Private</div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <div className="fixed bottom-12 left-0 right-0 z-50 flex flex-col items-center gap-6">
        <div className="flex gap-2">
          {steps.map((_, idx) => (
            <motion.div
              key={idx}
              initial={false}
              animate={{ width: currentStep === idx ? 24 : 6, backgroundColor: currentStep === idx ? 'rgb(52 211 153)' : 'rgb(64 64 64)' }}
              className="h-1 rounded-full"
              transition={{ duration: 0.3 }}
            />
          ))}
        </div>
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          onClick={handleNext}
          className="group flex items-center gap-2 rounded-full border border-green-500/40 bg-green-600/90 px-8 py-3 text-white transition-all duration-200 hover:bg-green-500"
        >
          <span className="text-sm font-medium">{currentStep === steps.length - 1 ? 'Start using Off Grid' : 'Continue'}</span>
          {currentStep === steps.length - 1 ? <Check className="h-4 w-4" weight="bold" /> : <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" weight="bold" />}
        </motion.button>
      </div>
    </div>
  );
}
