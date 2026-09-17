import '@testing-library/jest-dom/vitest';

// jsdom does not implement IntersectionObserver. Components use it only for
// progressive-enhancement UI (e.g. scroll-spy highlighting); this stub lets
// them mount without crashing, while real observation is left to browser-only
// or end-to-end tests.
// jsdom also does not implement scrollIntoView.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  // @ts-expect-error -- partial stub, sufficient for jsdom test mounting.
  globalThis.IntersectionObserver = IntersectionObserverStub;
}
