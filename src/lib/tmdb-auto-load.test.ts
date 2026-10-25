import { describe, expect, it, vi } from 'vitest';
import { observeTmdbLoadMore, type TmdbSentinelObserverFactory } from './tmdb-auto-load';

describe('observeTmdbLoadMore', () => {
  it('loads once when visible, avoids concurrent callbacks, and stops after an error', async () => {
    let onIntersect: IntersectionObserverCallback | undefined;
    let isFetching = false;
    let isError = false;
    let resolveLoad: (() => void) | undefined;
    const load = vi.fn(() => {
      isFetching = true;
      return new Promise<void>((resolve) => { resolveLoad = resolve; });
    });
    const observe = vi.fn();
    const disconnect = vi.fn();
    const factory: TmdbSentinelObserverFactory = (callback, options) => {
      onIntersect = callback;
      expect(options.rootMargin).toBe('300px 0px');
      return { observe, disconnect };
    };
    const target = {} as Element;
    const cleanup = observeTmdbLoadMore(target, () => !isFetching && !isError, load, factory);
    expect(observe).toHaveBeenCalledWith(target);

    const entry = { isIntersecting: true } as IntersectionObserverEntry;
    onIntersect?.([entry], {} as IntersectionObserver);
    onIntersect?.([entry], {} as IntersectionObserver);
    expect(load).toHaveBeenCalledTimes(1);

    isFetching = false;
    isError = true;
    resolveLoad?.();
    await Promise.resolve();
    await Promise.resolve();
    onIntersect?.([entry], {} as IntersectionObserver);
    expect(load).toHaveBeenCalledTimes(1);

    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();

    isError = false;
    isFetching = false;
    onIntersect?.([entry], {} as IntersectionObserver);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
