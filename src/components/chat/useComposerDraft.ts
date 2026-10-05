import { useEffect, useRef, type RefObject } from "react";

export function useComposerDraft(
  draft: { text: string; nonce: number } | undefined,
  setInput: (text: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>
) {
  const appliedDraftsRef = useRef(new Set<number>());
  useEffect(() => {
    if (!draft || appliedDraftsRef.current.has(draft.nonce)) return;
    appliedDraftsRef.current.add(draft.nonce);
    setInput(draft.text);
    textareaRef.current?.focus();
  }, [draft, setInput, textareaRef]);
}
