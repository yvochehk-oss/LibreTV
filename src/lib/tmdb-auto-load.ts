export type TmdbSentinelObserverFactory = (
  callback: IntersectionObserverCallback,
  options: IntersectionObserverInit,
) => Pick<IntersectionObserver, 'observe' | 'disconnect'>;

/** Watches a near-bottom sentinel and prevents repeated observer callbacks from starting concurrent loads. */
export function observeTmdbLoadMore(
  target: Element,
  canLoad: () => boolean,
  loadMore: () => Promise<unknown> | unknown,
  createObserver: TmdbSentinelObserverFactory = (callback, options) => new IntersectionObserver(callback, options),
): () => void {
  let loading = false;
  let disposed = false;
  const observer = createObserver((entries) => {
    if (disposed || loading || !entries.some((entry) => entry.isIntersecting) || !canLoad()) return;
    loading = true;
    try {
      void Promise.resolve(loadMore()).catch(() => undefined).finally(() => { loading = false; });
    } catch {
      loading = false;
    }
  }, { rootMargin: '300px 0px' });
  observer.observe(target);
  return () => {
    disposed = true;
    observer.disconnect();
  };
}
