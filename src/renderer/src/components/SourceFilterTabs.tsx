import { motion } from 'motion/react';
import { cn } from '@renderer/lib/utils';

const SOURCES = ['All', 'Claude', 'Gemini', 'ChatGPT'] as const;
export type Source = (typeof SOURCES)[number];

const COMING_SOON = ['Perplexity', 'Grok'] as const;

interface SourceFilterTabsProps {
    activeSource: Source;
    onSourceChange: (source: Source) => void;
    className?: string;
}

export function SourceFilterTabs({ activeSource, onSourceChange, className }: SourceFilterTabsProps) {
    return (
        <div className={cn("flex items-center gap-2", className)}>
            {SOURCES.map(source => (
                <button
                    key={source}
                    onClick={() => onSourceChange(source)}
                    className={cn(
                        "relative px-4 py-2 rounded-full text-sm font-medium transition-all",
                        activeSource === source
                            ? "text-white"
                            : "text-neutral-500 hover:text-neutral-300"
                    )}
                >
                    {activeSource === source && (
                        <motion.div
                            layoutId="activeSourceTab"
                            className="absolute inset-0 bg-neutral-800/80 border border-neutral-700 rounded-full"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                        />
                    )}
                    <span className="relative z-10">{source}</span>
                </button>
            ))}
            {COMING_SOON.map(source => (
                <span
                    key={source}
                    className="relative px-4 py-2 rounded-full text-sm font-medium text-neutral-600 cursor-not-allowed"
                    title="Coming soon"
                >
                    {source}
                    <span className="ml-1 text-[10px] align-super text-neutral-600">soon</span>
                </span>
            ))}
        </div>
    );
}
