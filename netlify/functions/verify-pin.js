const {
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  createSessionToken,
  safeCompare,
  connectBlobs
} = require('./lib/_shared');

const RATE_LIMIT_MAX = 8;              // max aantal inlogpogingen...
const RATE_LIMIT_WINDOW_MS = 900000;   // ...per 15 minuten per IP

exports.handler = async function(event) {
  connectBlobs(event);
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!isAllowedOrigin(origin)) {
    console.warn('Geweigerd verzoek van niet-toegestane origin:', origin || '(leeg)');
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Origin niet toegestaan' }) };
  }

  const ip = getClientIp(event);
  const allowed = await checkRateLimit('verify-pin-rate-limit', `ip:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Te veel pogingen. Probeer het over 15 minuten opnieuw.' })
    };
  }

  const APP_PIN = process.env.APP_PIN;
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!APP_PIN || !SESSION_SECRET) {
    console.error('APP_PIN of SESSION_SECRET ontbreekt als omgevingsvariabele op Netlify');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server niet correct geconfigureerd' }) };
  }

  let pin;
  try {
    const data = JSON.parse(event.body || '{}');
    pin = data.pin;
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig verzoek' }) };
  }

  if (typeof pin !== 'string' || pin.length === 0 || pin.length > 32 || !safeCompare(pin, APP_PIN)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Onjuiste pincode' }) };
  }

  const token = createSessionToken(SESSION_SECRET);
  return { statusCode: 200, headers, body: JSON.stringify({ success: true, token }) };
};
