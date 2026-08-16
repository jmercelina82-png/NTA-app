// Entry point: importeert alle modules (waarmee ook hun eigen top-level
// event-listener-koppelingen lopen), draait de opstart-initialisatie van het
// formulier, en koppelt de acties die vroeger via inline onclick/onchange-
// attributen liepen aan data-act/data-arg (zie index.html). Geen window.*-
// exposure meer nodig - dit maakt een CSP zonder 'unsafe-inline' voor
// script-src mogelijk (index.html), wat opgeslagen-XSS via geïnjecteerde
// event-handler-attributen (bv. <img onerror=...>) blokkeert.
import './auth.js';
import './api.js';
import './dashboard.js';
import './autosave.js';

import { pinKey, pinDel } from './auth.js';
import {
  naarTab, laadFoto, addALS, addRM, setCon, clearSign, initSign,
  buildOor, ELC, ELV, WTV, GSV, rmList
} from './form.js';
import {
  openPDF, sluitPDF, downloadPDF, openEmail, sluitEmail, verstuur, verstuurWhatsApp
} from './pdf.js';

// Acties zonder argument, of met een simpel string-argument uit data-arg.
const ACTIES = {
  pinKey, pinDel, addALS, addRM, setCon, clearSign,
  openPDF, sluitPDF, downloadPDF, openEmail, sluitEmail, verstuur, verstuurWhatsApp,
  naarTab: n => naarTab(parseInt(n, 10))
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.dataset.act === 'laadFoto') return; // laadFoto hoort bij het change-event hieronder
  const fn = ACTIES[el.dataset.act];
  if (!fn) return;
  if (el.dataset.arg !== undefined) fn(el.dataset.arg);
  else fn();
});
// laadFoto(input, key) heeft het input-element zelf nodig (this.files) en
// hoort bij een change-event, niet bij een klik.
document.addEventListener('change', e => {
  const el = e.target.closest('[data-act="laadFoto"]');
  if (el) laadFoto(el, el.dataset.arg);
});

// INIT
buildOor('el-checks',ELC); buildOor('el-vis',ELV);
buildOor('water-vis',WTV); buildOor('gas-vis',GSV);
initSign();
const td=new Date().toISOString().slice(0,10);
document.getElementById('datum').value=td;
document.getElementById('aft_dat').value=td;
addALS();
addRM(); document.querySelector('#rm-lijst .rm-item input[type=text]').value='Hal'; rmList[0].loc='Hal';
addRM(); document.querySelectorAll('#rm-lijst .rm-item input[type=text]')[1].value='Gang'; rmList[1].loc='Gang';
