import type { FastifyError, FastifyInstance } from 'fastify';

/**
 * One shape for every error response: `{ error, code, requestId? }`.
 *
 * Fastify's default handler echoes the thrown error's message, which for an
 * unexpected failure can expose internals (SQL, file paths, provider
 * details). Unexpected errors are logged in full and answered generically,
 * with the request ID so a report can be matched to the log line. Errors
 * Fastify raises itself for a bad request keep a plain, actionable message.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 600
        ? error.statusCode
        : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed');
      return reply.code(status).send({
        code: 'internal_error',
        error: 'Something went wrong on Beacon’s side. Try again in a moment.',
        requestId: request.id,
      });
    }
    request.log.info(
      { code: error.code, statusCode: status },
      'request rejected',
    );
    return reply.code(status).send(clientError(status, error.code));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ code: 'not_found', error: 'Not found' }),
  );
}

function clientError(
  status: number,
  fastifyCode: string | undefined,
): { code: string; error: string } {
  switch (fastifyCode) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return { code: 'payload_too_large', error: 'That request is too large.' };
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return { code: 'invalid_request', error: 'That request was not valid.' };
    default:
      return status === 429
        ? {
            code: 'rate_limited',
            error: 'Too many requests. Try again shortly.',
          }
        : { code: 'invalid_request', error: 'That request was not valid.' };
  }
}
