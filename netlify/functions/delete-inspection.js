const {
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  hasValidSession,
  connectBlobs
} = require('./lib/_shared');
const { getInspectieStore, isValidId, inspectieKey } = require('./lib/inspecties');

const RATE_LIMIT_MAX = 300;          // max aantal verzoeken (bulk opschonen kan meerdere aanroepen per sessie vergen)...
const RATE_LIMIT_WINDOW_MS = 3600000; // ...per uur per IP

exports.handler = async function (event) {
  connectBlobs(event);
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = corsHeaders(origin, 'Content-Type, X-Session-Token');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  if (!isAllowedOrigin(origin)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Origin niet toegestaan' }) };
  }
  if (!hasValidSession(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sessie verlopen of ongeldig, log opnieuw in' }) };
  }

  const ip = getClientIp(event);
  const allowed = await checkRateLimit('delete-inspection-rate-limit', `ip:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig verzoek' }) };
  }

  if (!isValidId(body.id)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig of ontbrekend id' }) };
  }

  try {
    const store = getInspectieStore();
    const key = inspectieKey(body.id);
    const rec = await store.get(key, { type: 'json' });
    if (!rec) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Inspectie niet gevonden' }) };
    }
    // Concepten EN afgeronde rapporten zijn verwijderbaar (AVG: handmatige
    // opschoonoptie per inspectie, geen automatische bewaartermijn). Foto's
    // staan inline als base64 in ditzelfde record - er is geen aparte
    // foto-opslag, dus deze ene delete() laat geen verweesde data achter.
    await store.delete(key);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('delete-inspection fout:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Kon inspectie niet verwijderen' }) };
  }
};
