import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerErrorHandling } from '../src/error-handling.js';

function app() {
  const instance = Fastify({ logger: false });
  registerErrorHandling(instance);
  instance.get('/boom', () =>
    Promise.reject(new Error('relation "secret_table" does not exist')),
  );
  instance.post('/echo', (request) => Promise.resolve(request.body));
  return instance;
}

describe('error handling', () => {
  it('never sends an unexpected error’s internals to the client', async () => {
    const response = await app().inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json<Record<string, string>>();
    expect(body).toMatchObject({ code: 'internal_error' });
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('secret_table');
  });

  it('answers malformed requests with a plain message and code', async () => {
    const response = await app().inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload: '{not json',
      url: '/echo',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'invalid_request',
      error: 'That request was not valid.',
    });
  });

  it('answers unknown routes as JSON', async () => {
    const response = await app().inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'not_found', error: 'Not found' });
  });
});
