import { type ComponentType, lazy, Suspense } from 'react';

/** Loads a rarely used screen on first use so the main bundle stays small (F9). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<Page extends ComponentType<any>>(
  load: () => Promise<{ default: Page }>,
): Page {
  const Loaded = lazy(load);
  function LazyPage(props: React.ComponentProps<Page>) {
    return (
      <Suspense fallback={null}>
        <Loaded {...props} />
      </Suspense>
    );
  }
  return LazyPage as unknown as Page;
}
