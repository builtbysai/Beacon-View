import { describe, expect, it } from 'vitest';

import {
  ALERT_BODY,
  alertPath,
  parseDesktopAlert,
  RecentAlerts,
} from '../src/alerts.js';

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

  it('knows health alerts, with copy that names no camera', () => {
    const alert = parseDesktopAlert({
      category: 'health',
      eventId: 'outbox-456',
      route: '/activity',
    });
    expect(alert).toMatchObject({ category: 'health' });
    expect(ALERT_BODY.health).toBe(
      'A Beacon camera has a battery or heat warning.',
    );
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

  it('sends an activity alert’s click to its camera, and others to their page', () => {
    expect(
      alertPath({ category: 'motion', eventId: 'abc-123', route: '/activity' }),
    ).toBe('/activity?alert=abc-123');
    expect(
      alertPath({
        category: 'security',
        eventId: 'abc-123',
        route: '/settings',
      }),
    ).toBe('/settings');
  });
});
