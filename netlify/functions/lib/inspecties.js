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

// Atomisch volgnummer toekennen via compare-and-swap (onlyIfMatch/onlyIfNew),
// zodat twee gelijktijdige "nieuwe inspectie"-verzoeken nooit hetzelfde nummer
// krijgen. Bij een conflict (iemand anders was net iets sneller) lezen we de
// nieuwe waarde opnieuw en proberen we het nogmaals. De atomiciteit komt
// volledig van de conditionele write (onlyIfMatch/onlyIfNew) - de lees hoeft
// dus geen 'strong' consistency te zijn (die vereist een uncachedEdgeURL die
// niet beschikbaar is in Lambda compatibility mode / via connectLambda). Een
// gedateerde lees leidt in het ergste geval alleen tot een extra conflict-
// retry, nooit tot een dubbel nummer.
async function claimRapportnummer(store, jaar = new Date().getFullYear()) {
  const key = `counter:rapportnummer:${jaar}`;
  // In het slechtste geval heeft de laatste van N gelijktijdige aanvragen N-1
  // retries nodig (elke retry is maar een lees + conditionele write, dus goedkoop).
  for (let poging = 0; poging < 50; poging++) {
    const entry = await store.getWithMetadata(key, { type: 'text' });
    const huidig = entry && entry.data ? parseInt(entry.data, 10) : 0;
    const volgende = (Number.isFinite(huidig) ? huidig : 0) + 1;
    const writeOptions = entry && entry.etag ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };

    const result = await store.set(key, String(volgende), writeOptions);
    if (result.modified) {
      return `NTA-${jaar}-${String(volgende).padStart(3, '0')}`;
    }
    // Conflict: een ander verzoek won de race, opnieuw proberen met verse data.
  }
  throw new Error('Kon geen rapportnummer toekennen (te veel gelijktijdige verzoeken)');
}

module.exports = {
  STORE_NAME,
  INSPECTIE_PREFIX,
  getInspectieStore,
  isValidId,
  inspectieKey,
  claimRapportnummer
};
