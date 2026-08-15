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
// BEKENDE, GEACCEPTEERDE BEPERKING: dit is een mitigatie, geen harde garantie.
// Drie aanpakken zijn empirisch getest in productie (debug-traces op
// gelijktijdige aanvragen) voordat op deze is uitgekomen:
// 1) onlyIfMatch/onlyIfNew (conditionele writes): meerdere schrijvers met een
//    IDENTIEKE etag kregen allemaal modified:true terug - geen echte
//    compare-and-swap-garantie op dit platform/deze functiemodus.
// 2) store.list() als bron van waarheid om botsingen te detecteren: zelfs met
//    3 seconden tussen aanvragen zag een latere aanvraag de net geschreven
//    data van een eerdere niet - list() blijkt een aanmerkelijk grotere
//    cache-/replicatievertraging te hebben dan losse get()/set() op een
//    specifieke key.
// 3) (huidige aanpak) claim-key per kandidaatnummer + dubbele bevestiging:
//    aanzienlijk beter (bij 20 gelijktijdige aanvragen ging unieke uitkomst
//    van 1/20 en 12/20 naar 17-20/20), maar bij zware gelijktijdige belasting
//    (~20 aanvragen binnen dezelfde milliseconden) bleven af en toe 2-3
//    botsingen over - twee schrijvers lazen allebei hun EIGEN net geschreven
//    waarde terug voordat de ander se schrijfactie zichtbaar werd.
//
// Grondoorzaak: Blobs' enige echte sterke-consistentiegarantie
// (consistency:'strong') vereist een uncachedEdgeURL die niet beschikbaar is
// via connectLambda() (Lambda compatibility mode, waar deze functions in
// draaien). Zonder die garantie is elke read-verify-aanpak kansberekening,
// nooit een harde garantie. Een echte garantie vereist een migratie naar de
// moderne Netlify Functions API (waar Blobs die garantie volgens Netlify's
// eigen documentatie wel biedt) - bewust uitgesteld, risico geaccepteerd
// voor nu omdat echte gelijktijdige "nieuwe inspectie"-clicks door meerdere
// monteurs in de praktijk zeldzaam en niet in de tientallen tegelijk zijn.
//
// Werking: voor een kandidaatnummer wordt een aparte "claim"-key beschreven
// met het eigen id (ongeconditioneerde set(), geen onlyIfMatch/onlyIfNew); na
// een korte pauze wordt diezelfde key teruggelezen en een tweede keer
// bevestigd na nog een pauze. Last-write-wins op die ene key bepaalt wie de
// slot houdt; de verliezer schuift door naar het eerstvolgende kandidaatnummer.
async function claimEnBewaarRapportnummer(store, rec, jaar = new Date().getFullYear()) {
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
