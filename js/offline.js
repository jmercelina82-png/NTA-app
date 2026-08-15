// Lokaal vangnet via IndexedDB voor de auto-save. Elke wijziging wordt eerst
// lokaal bewaard (foto's als base64 kunnen de ~5-10MB localStorage-limiet
// makkelijk overschrijden - IndexedDB heeft die beperking niet), en pas
// daarna geprobeerd te synchroniseren met de server. Bij een netwerkfout of
// timeout (nadrukkelijk niet bij een gewone 4xx/401 - dat is geen
// connectiviteitsprobleem en opnieuw proberen lost het niet op) blijft de
// wijziging lokaal gemarkeerd als "nog niet gesynchroniseerd" en wordt
// opnieuw geprobeerd bij het online-event en aanvullend elke 30s (online/
// offline-events zijn niet altijd betrouwbaar, dus een periodieke check als
// vangnet). Geen conflict-resolutie: single-gebruiker-tool (gedeelde login),
// laatste schrijfactie wint - consistent met hoe Blobs toch al werkt.
import { huidigId } from './state.js';
import { saveInspectionRequest } from './api.js';

const DB_NAAM = 'fsb-offline';
const DB_VERSIE = 1;
const STORE = 'inspecties';
const SYNC_TIMEOUT_MS = 15000;
const RETRY_INTERVAL_MS = 30000;

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB niet beschikbaar')); return; }
    const req = indexedDB.open(DB_NAAM, DB_VERSIE);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function req2promise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Bewaart de huidige (al gecomprimeerde) payload lokaal, status 'pending'
// totdat een sync-poging 'synced' of 'afgewezen' (4xx) maakt.
export async function bewaarLokaal(id, payload) {
  try {
    const db = await openDb();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    await req2promise(store.put({ id, payload, status: 'pending', laatstGewijzigd: Date.now() }));
  } catch (err) {
    console.warn('Lokaal bewaren (IndexedDB) mislukt:', err && err.message);
  }
}

async function zetStatus(id, status) {
  try {
    const db = await openDb();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const rec = await req2promise(store.get(id));
    if (!rec) return;
    rec.status = status;
    await req2promise(store.put(rec));
  } catch (_) { /* best effort - lokale kopie blijft gewoon staan */ }
}

// Volledige lokale kopie (incl. status), bv. om na een offline pagina-herlaad
// te herstellen. null als er niets lokaal bekend is voor dit id.
export async function haalLokaleKopie(id) {
  try {
    const db = await openDb();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    return (await req2promise(store.get(id))) || null;
  } catch (_) { return null; }
}

async function haalWachtend() {
  try {
    const db = await openDb();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const alles = await req2promise(store.getAll());
    return (alles || []).filter(r => r.status === 'pending');
  } catch (_) { return []; }
}

function toonSyncBanner(zichtbaar) {
  const el = document.getElementById('offline-banner');
  if (el) el.classList.toggle('on', !!zichtbaar);
}

async function verversSyncBanner() {
  if (!huidigId) { toonSyncBanner(false); return; }
  const lokaal = await haalLokaleKopie(huidigId);
  toonSyncBanner(!!lokaal && lokaal.status === 'pending');
}

function timeoutRace(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), ms))
  ]);
}

// Probeert één lokale wijziging naar de server te sturen. Geeft true terug
// bij succes. Een netwerkfout/timeout laat de status op 'pending' staan
// (later opnieuw geprobeerd); een 4xx (bv. 409 - al verzonden) markeert
// 'afgewezen' want opnieuw proberen lost dat niet op. 401 wordt al apart
// afgehandeld door apiFetch (sessie verlopen -> PIN-scherm), dat gedrag
// blijft ongewijzigd.
export async function probeerSync(id, payload) {
  let gelukt = false;
  try {
    const res = await timeoutRace(saveInspectionRequest(payload), SYNC_TIMEOUT_MS);
    if (res.ok) { await zetStatus(id, 'synced'); gelukt = true; }
    else if (res.status >= 400 && res.status < 500) { await zetStatus(id, 'afgewezen'); }
  } catch (_) { /* netwerkfout/timeout - blijft 'pending' */ }
  await verversSyncBanner();
  return gelukt;
}

// Probeert alle nog niet gesynchroniseerde wijzigingen opnieuw te versturen -
// ook van inspecties die niet meer open staan (bv. na een tabwissel of
// afgebroken sessie terwijl er nog geen verbinding was).
export async function syncAlleWachtend() {
  const wachtend = await haalWachtend();
  for (const rec of wachtend) {
    await probeerSync(rec.id, rec.payload);
  }
}

window.addEventListener('online', () => { syncAlleWachtend(); });
setInterval(() => { syncAlleWachtend(); }, RETRY_INTERVAL_MS);
