const {
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  hasValidSession,
  connectBlobs
} = require('./lib/_shared');
const { getInspectieStore, INSPECTIE_PREFIX } = require('./lib/inspecties');

const RATE_LIMIT_MAX = 120;         // max aantal verzoeken...
const RATE_LIMIT_WINDOW_MS = 3600000; // ...per uur per IP

function samenvatting(rec) {
  const f = rec.f || {};
  const stappen = rec.voortgangStappen || [false, false, false, false, false];
  const klaar = stappen.filter(Boolean).length;
  return {
    id: rec.id,
    rapportnummer: rec.rapportnummer,
    status: rec.status,
    adres: f.adres || '',
    plaats: f.plaats || '',
    datum: f.datum || '',
    opdrachtgever: f.opdrachtgever || '',
    inspecteur: f.inspecteur || '',
    con: rec.con || null,
    voortgangStappen: stappen,
    voortgang: `${klaar}/${stappen.length}`,
    aangemaakt: rec.aangemaakt,
    laatstGewijzigd: rec.laatstGewijzigd,
    verzonden: rec.verzonden
  };
}

exports.handler = async function (event) {
  connectBlobs(event);
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = corsHeaders(origin, 'Content-Type, X-Session-Token', 'GET, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  if (!isAllowedOrigin(origin)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Origin niet toegestaan' }) };
  }
  if (!hasValidSession(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sessie verlopen of ongeldig, log opnieuw in' }) };
  }

  const ip = getClientIp(event);
  const allowed = await checkRateLimit('list-inspections-rate-limit', `ip:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }) };
  }

  try {
    const store = getInspectieStore();
    const { blobs } = await store.list({ prefix: INSPECTIE_PREFIX });

    const records = await Promise.all(
      blobs.map(async (b) => {
        try {
          return await store.get(b.key, { type: 'json' });
        } catch (_) {
          return null;
        }
      })
    );

    const inspecties = records.filter(Boolean).map(samenvatting);

    return { statusCode: 200, headers, body: JSON.stringify({ inspecties }) };
  } catch (err) {
    console.error('list-inspections fout:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Kon inspecties niet ophalen' }) };
  }
};
