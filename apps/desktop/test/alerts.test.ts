import { describe, expect, it } from 'vitest';

import { parseDesktopAlert, RecentAlerts } from '../src/alerts.js';

describe('desktop alerts', () => {
  it('accepts the generic payload the backend sends', () => {
    expect(
      parseDesktopAlert({
        category: 'motion',
        eventId: 'outbox-123',
        route: '/activity',
      }),
    ).toEqual({
      category: 'motion',
      eventId: 'outbox-123',
      route: '/activity',
    });
  });

  it('rejects unknown categories, routes, and malformed IDs', () => {
    for (const value of [
      { category: 'toString', eventId: 'a', route: '/activity' },
      { category: 'motion', eventId: 'a', route: 'https://evil.example' },
      { category: 'motion', eventId: 'a', route: '/settings/../x' },
      { category: 'motion', eventId: '<script>', route: '/activity' },
      { category: 'motion', eventId: '', route: '/activity' },
      null,
      'motion',
    ])
      expect(parseDesktopAlert(value)).toBeNull();
  });

  it('shows each event once, forgetting the oldest beyond the limit', () => {
    const recent = new RecentAlerts(2);
    expect(recent.firstSighting('a')).toBe(true);
    expect(recent.firstSighting('a')).toBe(false);
    expect(recent.firstSighting('b')).toBe(true);
    expect(recent.firstSighting('c')).toBe(true);
    expect(recent.firstSighting('a')).toBe(true);
  });
});
