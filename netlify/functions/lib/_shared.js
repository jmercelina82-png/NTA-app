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
function createSessionToken(secret, ttlMs = 24 * 3600000) {
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

module.exports = {
  ALLOWED_ORIGINS,
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  createSessionToken,
  verifySessionToken,
  safeCompare,
  hasValidSession,
  connectBlobs
};
