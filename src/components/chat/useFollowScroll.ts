import { useCallback, useEffect, useRef, useState } from "react";

const FOLLOW_MARGIN_PX = 40;

export function useFollowScroll(sessionId: string, contentKey: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [isFollowing, setIsFollowing] = useState(true);
  const [hasUnseen, setHasUnseen] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    followingRef.current = true;
    setIsFollowing(true);
    setHasUnseen(false);
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        followingRef.current = entry.isIntersecting;
        setIsFollowing(entry.isIntersecting);
        if (entry.isIntersecting) setHasUnseen(false);
      },
      { root, rootMargin: `0px 0px ${FOLLOW_MARGIN_PX}px 0px` }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!followingRef.current) setHasUnseen(true);
  }, [contentKey]);

  useEffect(() => {
    scrollToBottom();
  }, [sessionId, scrollToBottom]);

  return { scrollRef, contentRef, sentinelRef, isFollowing, hasUnseen, scrollToBottom };
}
