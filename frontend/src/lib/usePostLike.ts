import { useState, useCallback } from 'react';
import { toggleLike } from './interactions';

/**
 * Shared like-toggle state machine (optimistic UI with rollback).
 * Used by both the feed card and the post page so behavior is identical.
 */
export function usePostLike(
  postId: string,
  userId: string | null,
  getToken: () => Promise<string | null>,
  initialLiked: boolean,
  initialCount: number
) {
  const [liked, setLiked] = useState(initialLiked);
  const [likesCount, setLikesCount] = useState(initialCount);
  const [likeBusy, setLikeBusy] = useState(false);

  const sync = useCallback((nextLiked: boolean, nextCount?: number) => {
    setLiked(nextLiked);
    if (nextCount !== undefined) setLikesCount(nextCount);
  }, []);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (!userId || likeBusy) return false;
    setLikeBusy(true);
    const prev = liked;
    setLiked(!prev);
    setLikesCount((c) => Math.max(0, c + (prev ? -1 : 1)));

    try {
      const token = await getToken();
      const next = await toggleLike(postId, userId, token, prev);
      setLiked(next);
      return true;
    } catch (err) {
      console.error('Error toggling like:', err);
      setLiked(prev);
      setLikesCount((c) => Math.max(0, c + (prev ? 1 : -1)));
      return false;
    } finally {
      setLikeBusy(false);
    }
  }, [postId, userId, getToken, liked, likeBusy]);

  return { liked, likesCount, likeBusy, toggle, sync };
}
