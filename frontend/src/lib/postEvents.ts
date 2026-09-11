import type { Post } from '../types';

export const POST_CREATED_EVENT = 'hibr:post-created';

export function notifyPostCreated(post: Post) {
  window.dispatchEvent(new CustomEvent<Post>(POST_CREATED_EVENT, { detail: post }));
}

export function subscribePostCreated(handler: (post: Post) => void): () => void {
  const listener = (e: Event) => {
    const post = (e as CustomEvent<Post>).detail;
    if (post) handler(post);
  };
  window.addEventListener(POST_CREATED_EVENT, listener);
  return () => window.removeEventListener(POST_CREATED_EVENT, listener);
}
