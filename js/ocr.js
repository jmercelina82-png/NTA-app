// OCR-suggestie voor meterstanden (v1: alleen gasmeter). Leest automatisch een
// suggestie uit een zojuist gemaakte foto en vult die als AI-suggestie in het
// bijbehorende invoerveld - zichtbaar gemarkeerd en altijd met een tik door de
// monteur te overschrijven voordat er iets naar de PDF gaat.
import { comprimeerFotos } from './utils.js';
import { ocrMeterRequest } from './api.js';

// veld-id -> metertype; alleen gas heeft in v1 een hook (zie form.js/laadFoto).
const METERVELDEN = { msgas: 'gas' };

function toonOcrStatus(veldId, tekst) {
  const el = document.getElementById('ocr-status-' + veldId);
  if (el) el.textContent = tekst;
}

function markeerAlsSuggestie(input) {
  input.classList.add('ai-suggestie');
  const wisSuggestie = () => {
    input.classList.remove('ai-suggestie');
    input.removeEventListener('input', wisSuggestie);
  };
  input.addEventListener('input', wisSuggestie);
}

export async function triggerOcrSuggestie(key, dataUrl) {
  const metertype = METERVELDEN[key];
  if (!metertype) return;
  const input = document.getElementById(key);
  if (!input) return;

  toonOcrStatus(key, 'Meterstand lezen...');
  try {
    const gecomprimeerd = await comprimeerFotos({ [key]: [{ d: dataUrl }] });
    const fotoBase64 = gecomprimeerd[key][0].d;
    const res = await ocrMeterRequest({ fotoBase64, metertype });
    if (!res.ok) {
      toonOcrStatus(key, 'Kon de meterstand niet automatisch lezen, vul handmatig in.');
      return;
    }
    const data = await res.json();
    if (!data.success || !data.waarde) {
      toonOcrStatus(key, 'Kon de meterstand niet automatisch lezen, vul handmatig in.');
      return;
    }
    input.value = data.waarde;
    markeerAlsSuggestie(input);
    toonOcrStatus(key, 'AI-suggestie ingevuld - controleer en pas aan indien nodig.');
  } catch (_) {
    toonOcrStatus(key, 'Kon de meterstand niet automatisch lezen, vul handmatig in.');
  }
}
