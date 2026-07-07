import {
  CalendarBlank,
  ChartLineUp,
  Rewind,
  Microphone,
  CheckSquare,
  Graph,
  MagnifyingGlass,
  Broadcast,
  ClipboardText,
  Waveform,
  ShieldCheck,
  PenNib,
} from '@phosphor-icons/react';
import type { ComponentType } from 'react';

// Static catalogue of the Pro features. This ships in the OPEN build so the free
// app can advertise everything Pro unlocks — the sidebar shows these as locked
// tabs and each opens an UpgradeScreen writeup with the payment CTA. When the
// pro/ submodule is present and activated, the real screens (registered via
// screenRegistry/navRegistry) take over these same routes.

/** Buy Pro — live now, $49/year or $69 once, one license across up to 5 devices. */
export const PRO_PAY_URL = 'https://getoffgridai.co/pay';

export interface ProFeature {
  /** Route name — matches the route a registered pro screen claims when unlocked. */
  route: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ComponentType<any>;
  /** One-line pitch shown under the title. */
  tagline: string;
  /** Upsell paragraph. */
  description: string;
  /** Concrete capabilities, shown as a checklist. */
  highlights: string[];
}

export const PRO_FEATURES: ProFeature[] = [
  {
    route: 'day',
    label: 'Day',
    icon: CalendarBlank,
    tagline: 'Your day, planned for you.',
    description:
      'Off Grid reads your calendar and what you’ve been working on and lays out your day — what’s next, who you’re meeting, and what’s still open — so you start every morning oriented instead of scrambling.',
    highlights: [
      'A morning briefing built from your real activity',
      'Per-meeting prep: who’s in it and your open items',
      'Priorities surfaced from what you actually did',
    ],
  },
  {
    route: 'reflect',
    label: 'Reflect',
    icon: ChartLineUp,
    tagline: 'See where your time really goes.',
    description:
      'A private, on-device breakdown of your focus — the apps, projects, and people that took your attention — so you can see your week clearly and adjust.',
    highlights: ['Daily & weekly mind-share', 'Focus vs. distraction trends', 'All computed locally — never uploaded'],
  },
  {
    route: 'replay',
    label: 'Replay',
    icon: Rewind,
    tagline: 'Rewind anything you saw.',
    description:
      'Scrub back through your screen history to find that doc, message, or number you know you saw — captured on-device and searchable.',
    highlights: ['Timeline of captured frames', 'Jump straight to the moment', 'Stays on your machine'],
  },
  {
    route: 'meetings',
    label: 'Meetings',
    icon: Microphone,
    tagline: 'Record & transcribe meetings, locally.',
    description:
      'Capture Zoom, Meet, and Teams calls with system audio + mic and get a private transcript and summary — no cloud meeting bot, nothing leaves your device.',
    highlights: ['Auto-detects calls', 'On-device transcription', 'Searchable transcripts & summaries'],
  },
  {
    route: 'actions',
    label: 'Actions',
    icon: CheckSquare,
    tagline: 'To-dos and actions, handled.',
    description:
      'Off Grid extracts the commitments out of your day and your secretary proposes the next step — every action waits in an approval queue, so nothing happens without your say-so.',
    highlights: ['Auto-extracted to-dos', 'Secretary-proposed actions', 'Approval-gated — you’re always in control'],
  },
  {
    route: 'entities',
    label: 'Entities',
    icon: Graph,
    tagline: 'A private graph of your work.',
    description:
      'Every person, project, and company you touch becomes a record with a synthesized story across your screen activity, meetings, and connectors — your own CRM that builds itself.',
    highlights: ['Auto-built people & project records', 'Cross-source narrative summaries', 'Relationship graph'],
  },
  {
    route: 'search',
    label: 'Search',
    icon: MagnifyingGlass,
    tagline: 'Search everything you’ve ever seen.',
    description:
      'One search bar across your captured activity, meetings, entities, and connectors — semantic + keyword, all on-device.',
    highlights: ['Unified semantic search', 'Across capture, meetings & connectors', 'Fully local'],
  },
  {
    route: 'notifications',
    label: 'Notifications',
    icon: Broadcast,
    tagline: 'Approvals & to-dos, surfaced.',
    description:
      'Off Grid reaches out first — a morning briefing, a heads-up before meetings, approvals waiting on your decision, and to-dos it pulled from your day — even when the window is closed.',
    highlights: ['Proactive briefings & meeting prep', 'Approval queue for actions', 'Auto-extracted to-dos'],
  },
  {
    route: 'voice',
    label: 'Voice',
    icon: Waveform,
    tagline: 'Talk instead of type, fully local.',
    description:
      'Hold Option+Space and speak — Off Grid AI Desktop transcribes on-device with whisper.cpp and pastes the text into whatever app you are in. Tap to toggle, hold to push-to-talk. Every recording and transcript is kept in a searchable library, and you can drop in any audio or video file to transcribe it. Runs in your Mac’s RAM; nothing leaves the device.',
    highlights: [
      'Option+Space push-to-talk or toggle, anywhere',
      'Paste-at-cursor + a searchable recordings library',
      'Transcribe any audio/video file, all on-device',
    ],
  },
  {
    route: 'scribe',
    label: 'Scribe',
    icon: PenNib,
    tagline: 'Say what you mean, in your words, on your Mac.',
    description:
      'Fix the typo before it reaches anyone, then make the sentence land. Scribe underlines spelling, grammar, and wordiness as you type and fixes it in a click. Select any text and change the tone, make it shorter, translate it, or ask for a better way to say it. It writes in your voice because it reads the same on-device memory as the rest of Off Grid AI Desktop - it knows your people, your projects, and how you write, so your names are never flagged and rewrites sound like you. Every word stays in your Mac. Nothing is sent anywhere.',
    highlights: [
      'Live spelling, grammar, and clarity fixes as you type',
      'Select to rewrite, change tone, shorten, or translate',
      'Knows your people and projects; writes in your voice, on-device',
    ],
  },
  {
    route: 'vault',
    label: 'Vault',
    icon: ShieldCheck,
    tagline: 'Passwords and secrets, encrypted on this device.',
    description:
      'An encrypted KDBX4 vault for web logins, app passwords, API keys, secure notes, and secret files (.env and the like). Your master password and a device-specific key together lock the vault - the file alone is unreadable. Back up the file anywhere; it stays opaque without both factors. Sync to other devices in your Off Grid mesh via EasyShare when you are ready.',
    highlights: [
      'AES-256 + Argon2id, device-key bound',
      'Logins, app passwords, API keys, notes, and files',
      'KDBX4 format - compatible with KeePassXC',
    ],
  },
  {
    route: 'clipboard',
    label: 'Clipboard',
    icon: ClipboardText,
    tagline: 'Every copy, kept and searchable.',
    description:
      'A local clipboard history that saves what you copy - text, images, and files - with a global hotkey (Cmd+Shift+C) quick-paste popup to drop any past copy into whatever app you are in. Stored on-device, nothing leaves your machine.',
    highlights: [
      'Searchable history of text, images & files',
      'Cmd+Shift+C quick-paste popup anywhere',
      'Stored locally in your encrypted database',
    ],
  },
];

export function getProFeature(route: string): ProFeature | undefined {
  return PRO_FEATURES.find((f) => f.route === route);
}
