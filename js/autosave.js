// Debounced auto-save: bewaart de huidige formulierstaat op de server tijdens
// het typen, en direct (geflusht) bij tabwissel/navigatie, zodat een concept
// nooit stale raakt.
import { huidigId } from './state.js';
import { leesFormulierData, berekenVoortgang } from './form.js';
import { comprimeerFotos } from './utils.js';
import { saveInspectionRequest } from './api.js';

let saveInFlight = null;
export async function serverSave() {
 if (!huidigId) return;
 const payload = { id: huidigId, ...leesFormulierData(), voortgangStappen: berekenVoortgang() };
 payload.fotos = await comprimeerFotos(payload.fotos, 480, 0.60);
 try {
 saveInFlight = saveInspectionRequest(payload);
 const res = await saveInFlight;
 if (res.ok) {
 const dot = document.getElementById('sdot');
 if (dot) { dot.classList.add('on'); setTimeout(()=>dot.classList.remove('on'), 1500); }
 }
 } catch(_) { /* auto-save mislukt stil; volgende trigger/tabwissel probeert opnieuw */ }
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
