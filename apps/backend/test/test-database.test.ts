import { describe, expect, it, vi } from 'vitest';

import { assertSafeTestDatabase, resetTestDatabase } from './test-database.js';

const validEnvironment = {
  DATABASE_URL: 'postgresql://localhost/beacon_secureview',
  NODE_ENV: 'test',
  TEST_DATABASE_URL:
    'postgresql://tester:secret@db.local/beacon_secureview_test',
};

describe('destructive test database safety', () => {
  it.each([
    [{ ...validEnvironment, TEST_DATABASE_URL: undefined }, 'required'],
    [{ ...validEnvironment, NODE_ENV: 'development' }, 'NODE_ENV=test'],
    [{ ...validEnvironment, TEST_DATABASE_URL: 'not a url' }, 'valid'],
    [
      {
        ...validEnvironment,
        TEST_DATABASE_URL: 'mysql://db.local/beacon_test',
      },
      'PostgreSQL',
    ],
    [
      {
        ...validEnvironment,
        TEST_DATABASE_URL: 'postgresql://db.local/beacon',
      },
      'forbidden',
    ],
    [
      {
        ...validEnvironment,
        TEST_DATABASE_URL: 'postgresql://db.local/beacon_secureview',
      },
      'forbidden',
    ],
    [
      {
        ...validEnvironment,
        TEST_DATABASE_URL: 'postgresql://db.local/postgres',
      },
      'forbidden',
    ],
    [
      {
        ...validEnvironment,
        TEST_DATABASE_URL: 'postgresql://db.local/template0',
      },
      'forbidden',
    ],
    [
      {
        ...validEnvironment,
        TEST_DATABASE_URL: 'postgresql://db.local/template1',
      },
      'forbidden',
    ],
    [
      {
        ...validEnvironment,
        TEST_DATABASE_URL: 'postgresql://db.local/beacon_integration',
      },
      'ending in "_test"',
    ],
    [
      {
        ...validEnvironment,
        DATABASE_URL: validEnvironment.TEST_DATABASE_URL,
      },
      'must not equal',
    ],
  ])('refuses an unsafe environment', (environment, message) => {
    expect(() => assertSafeTestDatabase(environment)).toThrow(message);
  });

  it('accepts and sanitizes a dedicated test target', () => {
    expect(assertSafeTestDatabase(validEnvironment)).toEqual({
      databaseName: 'beacon_secureview_test',
      host: 'db.local',
      url: validEnvironment.TEST_DATABASE_URL,
    });
  });

  it('asserts safety again inside destructive setup', async () => {
    const query = vi.fn();
    await expect(
      resetTestDatabase(
        { query },
        { ...validEnvironment, TEST_DATABASE_URL: undefined },
      ),
    ).rejects.toThrow('TEST_DATABASE_URL is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('prints only sanitized target details before reset', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await resetTestDatabase({ query }, validEnvironment);
    expect(log).toHaveBeenCalledWith(
      'Resetting dedicated test database host=db.local database=beacon_secureview_test',
    );
    expect(log.mock.calls.flat().join(' ')).not.toContain('secret');
    expect(query).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
