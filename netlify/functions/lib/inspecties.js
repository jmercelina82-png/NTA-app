const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'nta-inspecties';
const INSPECTIE_PREFIX = 'inspectie:';

// UUID's zoals crypto.randomUUID() genereert; voorkomt dat een aangeleverde id
// als key-traversal (bv. naar een counter-key) gebruikt kan worden.
const ID_REGEX = /^[a-zA-Z0-9-]{1,100}$/;

function getInspectieStore() {
  return getStore(STORE_NAME);
}

function isValidId(id) {
  return typeof id === 'string' && ID_REGEX.test(id);
}

function inspectieKey(id) {
  return INSPECTIE_PREFIX + id;
}

function wachtJitter(minMs = 120, maxMs = 320) {
  return new Promise(resolve => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

// Rapportnummer toekennen EN de inspectie opslaan.
//
// Eerdere aanpak(en) bleken in productie onbetrouwbaar, empirisch vastgesteld
// met een debug-trace op gelijktijdige/kort-na-elkaar aanvragen:
// 1) onlyIfMatch/onlyIfNew (conditionele writes): meerdere schrijvers met een
//    IDENTIEKE etag kregen allemaal modified:true terug - geen echte
//    compare-and-swap-garantie op dit platform/deze functiemodus.
// 2) store.list() als bron van waarheid om botsingen te detecteren: zelfs met
//    3 seconden tussen aanvragen zag een latere aanvraag de net geschreven
//    data van een eerdere niet - list() blijkt een aanmerkelijk grotere
//    cache-vertraging te hebben dan losse get()/set()-aanroepen op een
//    specifieke key (die in eerdere traces wel steeds de laatste stand lieten
//    zien binnen dezelfde serie aanvragen).
//
// Deze aanpak gebruikt daarom uitsluitend ongeconditioneerde set()/get() op
// SPECIFIEKE keys (geen list(), geen onlyIfMatch/onlyIfNew): voor een
// kandidaatnummer wordt een aparte "claim"-key beschreven met het eigen id;
// na een korte pauze wordt diezelfde key teruggelezen. Bij gelijktijdige
// concurrentie geldt last-write-wins op die ene key - wie zijn eigen id nog
// terugleest heeft de slot gewonnen, de ander schuift door naar het
// eerstvolgende kandidaatnummer. Een tweede, herhaalde bevestiging na nog een
// pauze verkleint het (nooit volledig te sluiten, want geen echte lock)
// resterende venster waarin een net iets latere schrijver alsnog dezelfde
// slot claimt nadat de eerste al "gewonnen" leek.
async function claimEnBewaarRapportnummer(store, rec, jaar = new Date().getFullYear(), trace = null) {
  const jaarPrefix = `NTA-${jaar}-`;
  const tellerKey = `counter:rapportnummer:${jaar}`;

  let n;
  try {
    const tellerRaw = await store.get(tellerKey, { type: 'text' });
    n = (tellerRaw ? parseInt(tellerRaw, 10) : 0) + 1;
  } catch (_) {
    n = 1;
  }
  if (!Number.isFinite(n) || n < 1) n = 1;

  for (let poging = 0; poging < 60; poging++) {
    const kandidaat = `${jaarPrefix}${String(n).padStart(3, '0')}`;
    const claimKey = `rapportnummer-claim:${kandidaat}`;

    await store.set(claimKey, rec.id);
    await wachtJitter();
    const eersteLezing = await store.get(claimKey);

    let gewonnen = eersteLezing === rec.id;
    if (gewonnen) {
      // Tweede bevestiging: verkleint het venster waarin een iets latere
      // schrijver dezelfde slot alsnog overschrijft na onze eerste lezing.
      await wachtJitter();
      const tweedeLezing = await store.get(claimKey);
      gewonnen = tweedeLezing === rec.id;
    }

    if (trace) trace.push({ poging, kandidaat, eigenId: rec.id, gewonnen });

    if (gewonnen) {
      rec.rapportnummer = kandidaat;
      await store.setJSON(inspectieKey(rec.id), rec);
      // Best effort: schuif de teller op als startpunt voor de volgende
      // aanvraag (voorkomt dat iedereen steeds vanaf 1 begint te zoeken).
      store.set(tellerKey, String(n)).catch(() => {});
      return kandidaat;
    }
    n++; // iemand anders won deze slot, probeer het eerstvolgende nummer
  }
  throw new Error('Kon geen uniek rapportnummer vaststellen (te veel gelijktijdige verzoeken)');
}

module.exports = {
  STORE_NAME,
  INSPECTIE_PREFIX,
  getInspectieStore,
  isValidId,
  inspectieKey,
  claimEnBewaarRapportnummer
};
