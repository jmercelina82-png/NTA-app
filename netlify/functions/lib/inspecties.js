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

async function alleInspecties(store) {
  const { blobs } = await store.list({ prefix: INSPECTIE_PREFIX });
  const records = await Promise.all(
    blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null))
  );
  return records.filter(Boolean);
}

function wachtJitter(minMs = 80, maxMs = 220) {
  return new Promise(resolve => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

async function volgendeVrijeNummer(store, jaarPrefix, eigenId, trace) {
  const records = await alleInspecties(store);
  const bezet = new Map(); // rapportnummer -> laagst bekende id die het claimt
  records.forEach(r => {
    if (r.id === eigenId) return;
    if (typeof r.rapportnummer === 'string' && r.rapportnummer.startsWith(jaarPrefix)) {
      const huidig = bezet.get(r.rapportnummer);
      if (!huidig || r.id < huidig) bezet.set(r.rapportnummer, r.id);
    }
  });
  let n = 1, kandidaat;
  do {
    kandidaat = `${jaarPrefix}${String(n).padStart(3, '0')}`;
    n++;
  } while (bezet.has(kandidaat));
  if (trace) trace.push({ actie: 'kandidaat-gekozen', kandidaat, aantalBezet: bezet.size });
  return kandidaat;
}

// Rapportnummer toekennen EN de inspectie opslaan.
//
// Blobs' conditionele writes (onlyIfMatch/onlyIfNew) bleken in productie
// onder gelijktijdige belasting niet betrouwbaar: meerdere schrijvers met een
// IDENTIEKE onlyIfMatch-etag kregen allemaal modified:true terug (empirisch
// vastgesteld met een debug-trace op 20 gelijktijdige aanvragen - 3 verzoeken
// "wonnen" dezelfde compare-and-swap). Vermoedelijk mist de Lambda-
// compatibility-mode context (connectLambda) de uncachedEdgeURL die nodig is
// voor een betrouwbare conditionele check, vergelijkbaar met de eerdere
// BlobsConsistencyError bij consistency:'strong' reads. We vertrouwen daarom
// niet langer op een atomaire primitive die dit platform/deze functiemodus
// niet blijkt te bieden.
//
// In plaats daarvan: optimistisch schrijven + verifiëren + deterministisch
// terugtrekken bij een botsing. list()/get()/setJSON() zonder condities zijn
// wel betrouwbaar gebleken (o.a. list-inspections gebruikt ze al maandenlang
// zonder problemen). Twee schrijvers die toch hetzelfde nummer kiezen,
// berekenen onafhankelijk van elkaar dezelfde uitkomst: degene met het
// laagste (UUID) id houdt het nummer, de ander hernummert zichzelf - zonder
// verdere coördinatie nodig te hebben. Kan een enkel volgnummer overslaan als
// een verliezer hernummert (geaccepteerd: uniciteit is de harde eis, geen
// gaten in de reeks is dat niet).
async function claimEnBewaarRapportnummer(store, rec, jaar = new Date().getFullYear(), trace = null) {
  const jaarPrefix = `NTA-${jaar}-`;

  rec.rapportnummer = await volgendeVrijeNummer(store, jaarPrefix, rec.id, trace);
  await store.setJSON(inspectieKey(rec.id), rec);

  for (let ronde = 0; ronde < 30; ronde++) {
    // Oplopende jitter: bij grote clusters gelijktijdige aanvragen helpt meer
    // spreiding om sneller te convergeren i.p.v. herhaald op elkaar te botsen.
    await wachtJitter(80 + ronde * 15, 220 + ronde * 15);

    const records = await alleInspecties(store);
    const botsers = records.filter(r => r.rapportnummer === rec.rapportnummer && r.id !== rec.id);

    if (trace) trace.push({ actie: 'verificatie', ronde, rapportnummer: rec.rapportnummer, botsers: botsers.map(b => b.id) });

    if (!botsers.length) {
      return rec.rapportnummer;
    }

    const winnaarId = [rec.id, ...botsers.map(r => r.id)].sort()[0];
    if (winnaarId === rec.id) {
      if (trace) trace.push({ actie: 'gewonnen', ronde });
      return rec.rapportnummer;
    }

    // Wij verliezen de botsing (niet het laagste id): hernummer onszelf.
    if (trace) trace.push({ actie: 'verloren-hernummeren', ronde, winnaarId });
    rec.rapportnummer = await volgendeVrijeNummer(store, jaarPrefix, rec.id, trace);
    await store.setJSON(inspectieKey(rec.id), rec);
  }

  // Zeer onwaarschijnlijk bij realistisch gebruik, maar geef nooit een
  // niet-geverifieerd nummer terug.
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
