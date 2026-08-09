const crypto = require('crypto');
const {
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  hasValidSession
} = require('./lib/_shared');
const {
  getInspectieStore,
  isValidId,
  inspectieKey,
  claimRapportnummer
} = require('./lib/inspecties');

const MAX_BODY_LEN = 9_000_000; // ruim boven wat gecomprimeerde fotos + formulierdata innemen
const RATE_LIMIT_MAX = 300;          // max aantal verzoeken (autosave loopt regelmatig)...
const RATE_LIMIT_WINDOW_MS = 3600000; // ...per uur per IP

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function schoonFormData(body) {
  return {
    f: isPlainObject(body.f) ? body.f : {},
    jnS: isPlainObject(body.jnS) ? body.jnS : {},
    oor: isPlainObject(body.oor) ? body.oor : {},
    als: Array.isArray(body.als) ? body.als : [],
    rm: Array.isArray(body.rm) ? body.rm : [],
    con: typeof body.con === 'string' ? body.con : null,
    fotos: isPlainObject(body.fotos) ? body.fotos : {},
    voortgangStappen: Array.isArray(body.voortgangStappen) && body.voortgangStappen.length === 5
      ? body.voortgangStappen.map(Boolean)
      : [false, false, false, false, false]
  };
}

exports.handler = async function (event) {
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
  const allowed = await checkRateLimit('save-inspection-rate-limit', `ip:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }) };
  }

  if ((event.body || '').length > MAX_BODY_LEN) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Verzoek te groot' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig verzoek' }) };
  }

  const store = getInspectieStore();
  const now = Date.now();

  try {
    if (!body.id) {
      // Nieuwe inspectie: rapportnummer atomisch toekennen, direct aanmaken als concept.
      const id = crypto.randomUUID();
      const rapportnummer = await claimRapportnummer(store);
      const rec = {
        id,
        rapportnummer,
        status: 'concept',
        ...schoonFormData(body),
        aangemaakt: now,
        laatstGewijzigd: now,
        verzonden: null
      };
      await store.setJSON(inspectieKey(id), rec);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id, rapportnummer, laatstGewijzigd: now }) };
    }

    if (!isValidId(body.id)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig id' }) };
    }

    const bestaand = await store.get(inspectieKey(body.id), { type: 'json' });
    if (!bestaand) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Inspectie niet gevonden' }) };
    }
    if (bestaand.status === 'afgerond') {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Rapport is al verzonden en kan niet meer bewerkt worden' }) };
    }

    // Het formulier stuurt het rapportnummer als onderdeel van f (net als adres/plaats/etc),
    // niet als los top-level veld - dat is waar de client 'm ook vandaan leest/toont.
    const clientRapportnummer = body.f && body.f.rapportnummer;
    const rapportnummer = typeof clientRapportnummer === 'string' && clientRapportnummer.trim()
      ? clientRapportnummer.trim()
      : bestaand.rapportnummer;

    const rec = {
      ...bestaand,
      ...schoonFormData(body),
      id: bestaand.id,
      rapportnummer,
      status: bestaand.status,
      aangemaakt: bestaand.aangemaakt,
      verzonden: bestaand.verzonden,
      laatstGewijzigd: now
    };
    await store.setJSON(inspectieKey(bestaand.id), rec);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: rec.id, rapportnummer, laatstGewijzigd: now }) };
  } catch (err) {
    console.error('save-inspection fout:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Kon inspectie niet opslaan' }) };
  }
};
