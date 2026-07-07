import type { ComponentType, RefObject, KeyboardEvent, ClipboardEvent } from 'react';
import { getSlot, SLOTS } from './slotRegistry';

// Contract for a registered composer editor (pro's Scribe AssistedTextarea). Core
// renders the registered editor with these props, or a plain <textarea> when none is
// registered. Keeping the contract in core lets both sides depend on one shape.
export interface EditorSlotProps {
  value: string;
  onChange: (value: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}

export function getComposerEditor(): ComponentType<EditorSlotProps> | undefined {
  return getSlot(SLOTS.composerEditor) as ComponentType<EditorSlotProps> | undefined;
}
