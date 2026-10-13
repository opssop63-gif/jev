import { timingSafeEqual } from 'node:crypto';

// Replace api/index.js in the existing Vercel project with this file.
// Required Vercel secrets: APP_CONNECT_TOKEN, TYPESAFE_API_KEY.
// Connection-only bridge: no brokerage credentials, accounts, or orders.
const SERVICE = 'kiwoom-jev-bridge';
const PROTOCOL_VERSION = 1;
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

function reply(res, status, payload) {
  return res.status(status).json({
    service: SERVICE,
    protocolVersion: PROTOCOL_VERSION,
    tradingEnabled: false,
    ...payload,
  });
}

function authorized(header, expected) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

function unitNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validProbe(result) {
  const answer = result?.answers?.connection;
  const probabilities = answer?.probabilities;
  return typeof result?.model === 'string'
    && /^jev-[a-zA-Z0-9_.-]{1,60}$/.test(result.model)
    && answer?.type === 'choice'
    && ['ready', 'not_ready'].includes(answer.choice)
    && unitNumber(answer.confidence)
    && unitNumber(probabilities?.ready)
    && unitNumber(probabilities?.not_ready)
    && Math.abs(probabilities.ready + probabilities.not_ready - 1) <= 0.01;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, { status: 'error', code: 'METHOD_NOT_ALLOWED' });
  }
  const connectToken = (process.env.APP_CONNECT_TOKEN || '').trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(connectToken)) {
    return reply(res, 503, { status: 'error', code: 'SERVER_TOKEN_MISSING' });
  }
  if (!authorized(req.headers.authorization, connectToken)) {
    return reply(res, 401, { status: 'error', code: 'UNAUTHORIZED' });
  }
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return reply(res, 415, { status: 'error', code: 'JSON_REQUIRED' });
  }
  if (Number(req.headers['content-length']) > 4096) {
    return reply(res, 413, { status: 'error', code: 'BODY_TOO_LARGE' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > 4096) return reply(res, 413, { status: 'error', code: 'BODY_TOO_LARGE' });
    try { body = JSON.parse(body); }
    catch { return reply(res, 400, { status: 'error', code: 'INVALID_JSON' }); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply(res, 400, { status: 'error', code: 'INVALID_REQUEST' });
  }
  if (body.action === 'start_trading') {
    return reply(res, 409, { status: 'error', code: 'TRADING_NOT_IMPLEMENTED' });
  }
  if (Object.keys(body).some(key => !['action', 'requestId', 'protocolVersion'].includes(key))
    || body.protocolVersion !== PROTOCOL_VERSION
    || typeof body.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(body.requestId)
    || !['check_connection', 'check_jev'].includes(body.action)) {
    return reply(res, 400, { status: 'error', code: 'INVALID_REQUEST' });
  }

  const apiKey = (process.env.TYPESAFE_API_KEY || '').trim();
  const model = (process.env.JEV_MODEL || 'jev-latest').trim();
  const context = {
    requestId: body.requestId,
    action: body.action,
    jevConfigured: apiKey.length > 0,
  };
  if (body.action === 'check_connection') {
    // This confirms the bridge and app password only, not the model key's validity.
    return reply(res, 200, { ...context, status: 'ok' });
  }
  if (!apiKey) return reply(res, 503, { ...context, status: 'error', code: 'JEV_KEY_MISSING' });
  if (!/^jev-[a-zA-Z0-9_.-]{1,60}$/.test(model)) {
    return reply(res, 400, { ...context, status: 'error', code: 'JEV_REQUEST_REJECTED' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const started = Date.now();
  try {
    // The caller cannot supply arbitrary prompts, API keys, or trading actions.
    const response = await fetch(JEV_URL, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        state: { service_status: 'ready', purpose: 'A connectivity check, with no trading or account data.' },
        questions: {
          connection: {
            type: 'choice',
            instructions: 'According to service_status in the state, is the service ready?',
            criteria: { ready: 'The service status is ready.', not_ready: 'The service status is not ready.' },
          },
        },
      }),
    });
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'JEV_AUTH_FAILED'
        : response.status === 402 ? 'JEV_CREDIT_REQUIRED'
          : response.status === 429 ? 'JEV_RATE_LIMITED'
            : response.status >= 500 ? 'JEV_UNAVAILABLE' : 'JEV_REQUEST_REJECTED';
      // Never expose upstream error bodies, authorization headers, or environment values.
      if (response.body) await response.body.cancel();
      return reply(res, response.status === 429 ? 429 : 502, { ...context, status: 'error', code });
    }
    let result;
    try { result = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      return reply(res, 502, { ...context, status: 'error', code: 'JEV_INVALID_RESPONSE' });
    }
    if (!validProbe(result)) {
      return reply(res, 502, { ...context, status: 'error', code: 'JEV_INVALID_RESPONSE' });
    }
    const answer = result.answers.connection;
    return reply(res, 200, {
      ...context,
      status: 'ok',
      model: result.model,
      upstreamElapsedMs: Date.now() - started,
      probe: {
        type: 'choice',
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: { ready: answer.probabilities.ready, not_ready: answer.probabilities.not_ready },
      },
    });
  } catch {
    return reply(res, controller.signal.aborted ? 504 : 502, {
      ...context, status: 'error', code: controller.signal.aborted ? 'JEV_TIMEOUT' : 'JEV_UNAVAILABLE',
    });
  } finally {
    clearTimeout(timer);
  }
}
