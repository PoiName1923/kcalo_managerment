import { randomUUID } from 'node:crypto';

export function redact(value: string): string {
  let result = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (/token|key|secret|password|cookie/i.test(key) && secret && secret.length >= 8) result = result.split(secret).join('[REDACTED]');
  }
  return result.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED]');
}

export function logError(event: string, error: unknown, context: Record<string, unknown> = {}) {
  const requestId = randomUUID();
  const safeContext = Object.fromEntries(Object.entries(context).filter(([key]) => /^(job_id|update_id|attempt|method|provider|status)$/.test(key)));
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event, requestId,
    ...safeContext, error: error instanceof Error ? { name: error.name, message: redact(error.message), stack: redact(error.stack ?? '') } : { name: 'UnknownError' } }));
  return requestId;
}
