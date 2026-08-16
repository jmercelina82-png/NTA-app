const crypto = require('crypto');
const {
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  hasValidSession,
  connectBlobs,
  logActie
} = require('./lib/_shared');
const {
  getInspectieStore,
  isValidId,
  inspectieKey,
  claimEnBewaarRapportnummer
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
      // Nieuwe inspectie: direct aanmaken als concept, rapportnummer wordt
      // toegekend (en de inspectie opgeslagen) door claimEnBewaarRapportnummer.
      const id = crypto.randomUUID();
      const rec = {
        id,
        rapportnummer: null,
        status: 'concept',
        ...schoonFormData(body),
        aangemaakt: now,
        laatstGewijzigd: now,
        verzonden: null
      };
      const rapportnummer = await claimEnBewaarRapportnummer(store, rec);
      // Loggen vóór het antwoord terugsturen - in een Lambda-achtige omgeving
      // kan werk na de response niet gegarandeerd nog doorlopen, dus een
      // "fire-and-forget" hier zou het logregel stil kunnen laten verdwijnen.
      // logActie() zelf is best-effort (blokkeert/faalt de actie niet).
      await logActie(event, 'aangemaakt', id);
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

    // Rapportnummer is server-only en onveranderlijk zodra het is toegekend
    // (bij aanmaken, via claimEnBewaarRapportnummer). Een door de client
    // meegestuurd rapportnummer wordt hier volledig genegeerd - ook al stuurt
    // het formulier het als onderdeel van f (net als adres/plaats/etc, waar
    // de client 'm ook vandaan leest/toont), dat mag nooit het oorspronkelijk
    // toegekende nummer overschrijven.
    const rec = {
      ...bestaand,
      ...schoonFormData(body),
      id: bestaand.id,
      rapportnummer: bestaand.rapportnummer,
      status: bestaand.status,
      aangemaakt: bestaand.aangemaakt,
      verzonden: bestaand.verzonden,
      laatstGewijzigd: now
    };
    rec.f.rapportnummer = bestaand.rapportnummer;
    await store.setJSON(inspectieKey(bestaand.id), rec);
    await logActie(event, 'bijgewerkt', rec.id);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: rec.id, rapportnummer: rec.rapportnummer, laatstGewijzigd: now }) };
  } catch (err) {
    console.error('save-inspection fout:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Kon inspectie niet opslaan' }) };
  }
};
