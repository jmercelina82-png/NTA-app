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
// nieuwe waarde opnieuw en proberen we het nogmaals.
async function claimRapportnummer(store, jaar = new Date().getFullYear()) {
  const key = `counter:rapportnummer:${jaar}`;
  for (let poging = 0; poging < 20; poging++) {
    const entry = await store.getWithMetadata(key, { type: 'text', consistency: 'strong' });
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
