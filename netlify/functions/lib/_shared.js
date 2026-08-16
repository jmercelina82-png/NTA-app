const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

// Onze functions gebruiken nog de klassieke exports.handler(event)-signatuur
// ("Lambda compatibility mode"). In die modus injecteert Netlify de
// Blobs-omgeving niet automatisch als env var; die zit als event.blobs op het
// Lambda-event en moet expliciet ontsloten worden via connectLambda(event),
// als allereerste statement in de handler, voordat enige getStore()-aanroep
// (ook indirect, via checkRateLimit) plaatsvindt. Zonder dit gooit getStore()
// een MissingBlobsEnvironmentError. Defensief in een try/catch: lokaal (of in
// een test) waar event.blobs ontbreekt mag dit de aanroep niet laten crashen -
// een ontbrekende Blobs-omgeving leidt dan verderop tot dezelfde nette
// fail-open (rate limit) of 500 (echte opslag) als voorheen.
function connectBlobs(event) {
  try {
    connectLambda(event);
  } catch (_) {
    // Geen (geldige) event.blobs beschikbaar - Blobs blijft ongeconfigureerd.
  }
}

// ALLOWED_ORIGINS: comma-gescheiden lijst met domeinen die de functies mogen aanroepen.
// Instellen in Netlify: Site settings -> Environment variables -> ALLOWED_ORIGINS
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:8888,http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Browsers laten de Origin-header weg bij same-origin GET-verzoeken (alleen
// "unsafe" methodes zoals POST krijgen 'm gegarandeerd mee) - een lege origin
// betekent dus een gewoon same-origin verzoek vanuit onze eigen pagina, geen
// cross-site aanroep. Alleen een AANWEZIGE, niet-toegestane origin wordt geweigerd.
function corsHeaders(origin, allowHeaders = 'Content-Type', allowMethods = 'POST, OPTIONS') {
  const headers = {
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Methods': allowMethods,
    'Vary': 'Origin'
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGINS.includes(origin) ? origin : 'null';
  }
  return headers;
}

function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

function getClientIp(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

// Best-effort rate limiting via Netlify Blobs. Als de store om wat voor reden dan
// ook niet beschikbaar is, faalt het verzoek niet dicht, maar loggen we het wel.
async function checkRateLimit(storeName, key, max, windowMs) {
  try {
    const store = getStore(storeName);
    const now = Date.now();
    const raw = await store.get(key, { type: 'json' });
    const hits = Array.isArray(raw) ? raw.filter(t => now - t < windowMs) : [];

    if (hits.length >= max) {
      return false;
    }

    hits.push(now);
    await store.setJSON(key, hits);
    return true;
  } catch (err) {
    console.warn(`Rate limit check overgeslagen (${storeName} niet beschikbaar):`, err.message);
    return true;
  }
}

// Fail-closed variant voor endpoints waar "even niemand toelaten" veiliger
// is dan "onbeperkt doorlaten bij een storing" - kostbare AI-aanroepen
// (OCR) zonder limiet bij een Blobs-hapering is een reëel misbruik-/
// kostenrisico. Zelfde teller-logica als checkRateLimit(), alleen de
// catch-uitkomst is omgedraaid.
async function checkRateLimitFailClosed(storeName, key, max, windowMs) {
  try {
    const store = getStore(storeName);
    const now = Date.now();
    const raw = await store.get(key, { type: 'json' });
    const hits = Array.isArray(raw) ? raw.filter(t => now - t < windowMs) : [];

    if (hits.length >= max) {
      return false;
    }

    hits.push(now);
    await store.setJSON(key, hits);
    return true;
  } catch (err) {
    console.warn(`Rate limit (fail-closed) geweigerd - ${storeName} niet beschikbaar:`, err.message);
    return false; // FAIL CLOSED: liever tijdelijk niemand toelaten dan onbeperkt doorlaten
  }
}

// Fail-closed + zo atomair mogelijke rate limiting, specifiek voor login
// (verify-pin: klein aantal pogingen per venster, dus een scan door alle
// slots is goedkoop - dit is NIET bedoeld voor endpoints met een hoog max,
// zoals OCR, waar checkRateLimitFailClosed() hierboven volstaat).
//
// Atomiciteit: elke poging claimt een eigen, genummerde slot-key binnen het
// huidige (vaste) tijdvenster, in plaats van één gedeelde teller-array te
// lezen en terug te schrijven - dat laatste laat gelijktijdige schrijvers
// elkaars update verliezen, zoals uitgebreid aangetoond bij de rapportnummer-
// race condition (zie lib/inspecties.js: claimEnBewaarRapportnummer). Elke
// claim wordt na een korte pauze herlezen ter bevestiging, dezelfde aanpak
// als daar. Geen waterdichte garantie (dezelfde onderliggende Blobs-
// beperking - geen echte compare-and-swap in deze Lambda-compatibiliteits-
// modus - blijft gelden), maar begrenst hoeveel gelijktijdige verzoeken
// elkaar in de praktijk kunnen voorbijschieten tot ruwweg het aantal
// daadwerkelijk gelijktijdige verzoeken, in plaats van een ongelimiteerd
// race-venster. Vast (niet schuivend) venster: rond een venstergrens kan een
// aanvaller in het slechtste geval ruwweg 2x het geconfigureerde maximum
// kort na elkaar proberen - een bewust geaccepteerde, begrensde afweging ten
// opzichte van complexiteit die op dit platform toch geen harde garantie
// zou geven.
async function checkLoginRateLimit(storeName, key, max, windowMs) {
  try {
    const store = getStore(storeName);
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;

    for (let slot = 0; slot < max; slot++) {
      const slotKey = `${key}:${windowStart}:${slot}`;
      const bestaand = await store.get(slotKey);
      if (bestaand) continue; // deze slot is al bezet, probeer de volgende
      await store.set(slotKey, String(now));
      await new Promise(resolve => setTimeout(resolve, 60 + Math.random() * 120));
      const controle = await store.get(slotKey);
      if (controle === String(now)) return true; // deze poging heeft de slot echt gewonnen
      // Iemand anders overschreef onze claim gelijktijdig - probeer de volgende slot.
    }
    return false; // alle slots binnen dit venster zijn bezet
  } catch (err) {
    console.warn(`Login rate limit (fail-closed) geweigerd - ${storeName} niet beschikbaar:`, err.message);
    return false; // FAIL CLOSED: liever tijdelijk niemand toelaten dan onbeperkt gokken toestaan
  }
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function sign(payload, secret) {
  return base64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

// Simpel HMAC-ondertekend sessietoken: base64url(payload).base64url(handtekening).
// Geen JWT-library nodig, geen "alg: none" of andere JWT-valkuilen.
// 8 uur (werkdag-lengte) i.p.v. 24 - kortere sessies bij een gedeelde PIN
// verkleinen het venster waarin een gestolen/vergeten-uitgelogd token
// bruikbaar blijft. Pas ook js/auth.js aan bij wijziging van deze waarde
// (de client controleert los of een bewaard token nog binnen de geldigheids-
// termijn valt, voordat 'm hier al dan niet geweigerd wordt).
function createSessionToken(secret, ttlMs = 8 * 3600000) {
  const payload = base64url(JSON.stringify({ exp: Date.now() + ttlMs }));
  return `${payload}.${sign(payload, secret)}`;
}

function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;

  const expectedSig = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const data = JSON.parse(base64urlDecode(payload));
    return typeof data.exp === 'number' && Date.now() < data.exp;
  } catch (_) {
    return false;
  }
}

// Vergelijkt twee strings via hashes van gelijke lengte, zodat de lengte van
// het geheim (of van de invoer) niet via timing kan lekken.
function safeCompare(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Gedeelde sessie-check voor alle functions die achter het PIN-scherm zitten.
// Geeft true terug als event.headers['x-session-token'] geldig is voor SESSION_SECRET.
function hasValidSession(event) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  return verifySessionToken(event.headers['x-session-token'], secret);
}

// Lichte accountability-logging (geen zware audit-infrastructuur: geen UI,
// gewoon genoeg om achteraf te kunnen reconstrueren wat er gebeurd is bij een
// gedeelde PIN - wie/wanneer is niet te herleiden naar een persoon, maar
// tijdstip + IP + actie + inspectie-id samen wel bruikbaar voor reconstructie).
// Eigen, aparte Blobs-store (nta-logboek), gescheiden van de inspectiedata
// zelf. Eén key per logregel (geen read-modify-write op een groeiende lijst -
// dat zou zowel traag als race-gevoelig worden), dus puur een append-only set
// van schrijfacties zonder onderlinge afhankelijkheid. Loggen is altijd
// best-effort: een loghapering mag de eigenlijke actie (opslaan/versturen/
// verwijderen) nooit blokkeren of laten mislukken.
//
// Bewaartermijn: het logboek bevat IP-adressen (persoonsgegeven, los van de
// inspectiedata) - regels ouder dan 90 dagen worden opgeruimd. Geen aparte
// scheduled function ervoor (onnodige complexiteit voor deze schaal): bij
// een klein percentage van de schrijfacties wordt de lijst gescand en worden
// verlopen regels verwijderd. De tijdstempel staat al in de key (geen aparte
// lees per entry nodig om te bepalen of iets verlopen is). Best effort, net
// als de rest van dit logboek - een gemiste opruimronde wordt bij een latere
// schrijfactie alsnog opgepakt.
const LOGBOEK_STORE = 'nta-logboek';
const LOGBOEK_BEWAARTERMIJN_MS = 90 * 24 * 3600000;
const LOGBOEK_OPRUIM_KANS = 0.05; // gemiddeld 1 op de 20 schrijfacties

async function ruimOudeLogregelsOp(store) {
  try {
    const grens = Date.now() - LOGBOEK_BEWAARTERMIJN_MS;
    const { blobs } = await store.list({ prefix: 'log:' });
    await Promise.all(blobs.map(async (b) => {
      // Key-formaat: 'log:' + ISO-tijdstip (24 tekens, zelf ook dubbele
      // punten bevattend) + ':' + 8 hex-tekens. Vaste lengtes, dus het
      // ISO-deel er met slice() uit halen i.p.v. op ':' te splitsen.
      const isoDeel = b.key.slice(4, -9);
      const tijd = Date.parse(isoDeel);
      if (Number.isFinite(tijd) && tijd < grens) {
        await store.delete(b.key).catch(() => {});
      }
    }));
  } catch (err) {
    console.warn('Opruimen oude logregels mislukt (best effort):', err.message);
  }
}

async function logActie(event, actie, inspectieId) {
  try {
    const store = getStore(LOGBOEK_STORE);
    const tijdstip = new Date().toISOString();
    const key = `log:${tijdstip}:${crypto.randomUUID().slice(0, 8)}`;
    await store.setJSON(key, { tijdstip, actie, inspectieId, ip: getClientIp(event) });
    if (Math.random() < LOGBOEK_OPRUIM_KANS) {
      await ruimOudeLogregelsOp(store);
    }
  } catch (err) {
    console.warn('Kon actie niet loggen (logboek aparte zorg, blokkeert de actie zelf niet):', err.message);
  }
}

module.exports = {
  ALLOWED_ORIGINS,
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  checkRateLimitFailClosed,
  checkLoginRateLimit,
  createSessionToken,
  verifySessionToken,
  safeCompare,
  hasValidSession,
  connectBlobs,
  logActie
};
