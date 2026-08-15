// Entry point: importeert alle modules (waarmee ook hun eigen top-level
// event-listener-koppelingen lopen), draait de opstart-initialisatie van het
// formulier, en hangt de functies die nog vanuit inline onclick/onchange-
// attributen in de HTML aangeroepen worden aan window.
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

// Inline onclick="..."/onchange="..." attributen in index.html verwachten
// deze functies als globals (zie index.html voor de aanroepen).
window.pinKey = pinKey;
window.pinDel = pinDel;
window.naarTab = naarTab;
window.laadFoto = laadFoto;
window.addALS = addALS;
window.addRM = addRM;
window.setCon = setCon;
window.clearSign = clearSign;
window.openPDF = openPDF;
window.sluitPDF = sluitPDF;
window.downloadPDF = downloadPDF;
window.openEmail = openEmail;
window.sluitEmail = sluitEmail;
window.verstuur = verstuur;
window.verstuurWhatsApp = verstuurWhatsApp;

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
