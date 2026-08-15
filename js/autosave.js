// Debounced auto-save: bewaart de huidige formulierstaat op de server tijdens
// het typen, en direct (geflusht) bij tabwissel/navigatie, zodat een concept
// nooit stale raakt.
import { huidigId } from './state.js';
import { leesFormulierData, berekenVoortgang } from './form.js';
import { comprimeerFotos } from './utils.js';
import { bewaarLokaal, probeerSync } from './offline.js';

// Eerst altijd lokaal (IndexedDB) bewaren - dat mag nooit mislukken op een
// manier die werk verliest, ook niet zonder verbinding - en pas daarna een
// server-sync proberen. Bij een netwerkfout/timeout blijft de wijziging
// lokaal gemarkeerd en probeert offline.js het later opnieuw (online-event +
// periodieke check); zie offline.js voor die logica en de sync-indicator.
export async function serverSave() {
 if (!huidigId) return;
 const payload = { id: huidigId, ...leesFormulierData(), voortgangStappen: berekenVoortgang() };
 payload.fotos = await comprimeerFotos(payload.fotos, 480, 0.60);

 await bewaarLokaal(huidigId, payload);
 const gelukt = await probeerSync(huidigId, payload);
 if (gelukt) {
 const dot = document.getElementById('sdot');
 if (dot) { dot.classList.add('on'); setTimeout(()=>dot.classList.remove('on'), 1500); }
 }
}

let saveTimer = null;
export function cancelPendingSave() { clearTimeout(saveTimer); }
export function triggerSave() {
 if (!huidigId) return;
 clearTimeout(saveTimer);
 saveTimer = setTimeout(serverSave, 2500);
}
document.addEventListener('input', triggerSave);
document.addEventListener('click', triggerSave);
