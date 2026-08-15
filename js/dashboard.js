// Dashboard: lijst openstaand/afgerond ophalen en renderen, "+ Nieuwe
// inspectie", navigatie tussen dashboard en formulier.
import { huidigId, setHuidigId } from './state.js';
import { cancelPendingSave, serverSave } from './autosave.js';
import { naarTab, resetFormulier, vulFormulier } from './form.js';
import { openPDF, openEmail } from './pdf.js';
import { listInspectionsRequest, getInspectionRequest, saveInspectionRequest } from './api.js';

let dashData = [];

function toonDashFout() {
 const msg = '<div class="dash-leeg">Kon inspecties niet laden. Controleer de verbinding.</div>';
 document.getElementById('w-lijst-open').innerHTML = msg;
 document.getElementById('w-lijst-klaar').innerHTML = msg;
}

export async function verversDashboard() {
 try {
 const res = await listInspectionsRequest();
 if (!res.ok) { toonDashFout(); return; }
 const data = await res.json();
 dashData = data.inspecties || [];
 renderDash();
 } catch(_) { toonDashFout(); }
}

export function toonDashboardNaLogin() {
 document.getElementById('dash').classList.add('on');
 verversDashboard();
}

export async function openDash() {
 cancelPendingSave();
 if (huidigId) await serverSave();
 document.getElementById('btn-sluitdash').style.display = huidigId ? '' : 'none';
 document.getElementById('dash').classList.add('on');
 verversDashboard();
}
export function sluitDash() {
 if (!huidigId) return;
 document.getElementById('dash').classList.remove('on');
}

function renderDash() {
 const d = new Date().toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'});
 document.getElementById('d-dat').textContent = d;
 const open = dashData.filter(w=>w.status==='concept');
 const klaar = dashData.filter(w=>w.status==='afgerond');
 document.getElementById('s-tot').textContent = dashData.length;
 document.getElementById('s-op').textContent = open.length;
 document.getElementById('s-kl').textContent = klaar.length;
 document.getElementById('dash-teller').textContent = open.length;

 const ulOpen = document.getElementById('w-lijst-open'); ulOpen.innerHTML = '';
 if (!open.length) {
 ulOpen.innerHTML = '<div class="dash-leeg">Geen openstaande inspecties</div>';
 } else {
 open.sort((a,b)=>(b.laatstGewijzigd||0)-(a.laatstGewijzigd||0)).forEach(w => {
 const isA = w.id === huidigId;
 const adr = w.adres || 'Nieuwe inspectie';
 const bezig = (w.voortgangStappen||[]).some(Boolean);
 const stL = bezig ? 'Bezig' : 'Concept';
 const stC = bezig ? 'o' : 'n';
 const div = document.createElement('div'); div.className='wc'+(isA?' act':'');
 div.innerHTML = `
 <div class="wdot wdot-${stC}"></div>
 <div class="wi">
 <div class="wa">${adr}</div>
 <div class="wm">${w.rapportnummer||''} · ${w.datum||''} · ${w.voortgang}</div>
 </div>
 <span class="wb wb-${stC}">${stL}</span>
 <button class="wbtn" data-lid="${w.id}">${isA ? 'Verder' : 'Open'}</button>`;
 div.querySelectorAll('[data-lid]').forEach(b => b.addEventListener('click', function(){ laadInspectie(this.dataset.lid); }));
 ulOpen.appendChild(div);
 });
 }

 const ulKlaar = document.getElementById('w-lijst-klaar'); ulKlaar.innerHTML = '';
 if (!klaar.length) {
 ulKlaar.innerHTML = '<div class="dash-leeg">Nog geen afgeronde rapporten</div>';
 } else {
 klaar.sort((a,b)=>(b.verzonden||0)-(a.verzonden||0)).forEach(w => {
 const div = document.createElement('div'); div.className='wc';
 div.innerHTML = `
 <div class="wdot wdot-k"></div>
 <div class="wi">
 <div class="wa">${w.adres||''}</div>
 <div class="wm">${w.rapportnummer||''} · ${w.datum||''}</div>
 </div>
 <span class="wb wb-k">Afgerond</span>
 <button class="wbtn" data-aid="${w.id}">Bekijk</button>`;
 div.querySelectorAll('[data-aid]').forEach(b => b.addEventListener('click', function(){ toonArchiefDetail(w); }));
 ulKlaar.appendChild(div);
 });
 }
}

export function toonArchiefDetail(w) {
 const cL = w.con==='g'?'Geen bezwaar': w.con==='e'?'Enig bezwaar': w.con==='r'?'Ernstig bezwaar':'Onbekend';
 const verz = w.verzonden ? new Date(w.verzonden).toLocaleString('nl-NL') : '-';
 document.getElementById('archief-detail-inhoud').innerHTML = `
 <div class="arch-rij"><span class="lb2">Rapportnummer</span><span class="wa">${w.rapportnummer||''}</span></div>
 <div class="arch-rij"><span class="lb2">Adres</span><span class="wa">${w.adres||''}, ${w.plaats||''}</span></div>
 <div class="arch-rij"><span class="lb2">Datum keuring</span><span class="wa">${w.datum||''}</span></div>
 <div class="arch-rij"><span class="lb2">Opdrachtgever</span><span class="wa">${w.opdrachtgever||''}</span></div>
 <div class="arch-rij"><span class="lb2">Inspecteur</span><span class="wa">${w.inspecteur||''}</span></div>
 <div class="arch-rij"><span class="lb2">Eindoordeel</span><span class="wa">${cL}</span></div>
 <div class="arch-rij"><span class="lb2">Verzonden</span><span class="wa">${verz}</span></div>
 <div style="display:flex;gap:8px;margin-top:16px;">
 <button class="btn-wit" id="arch-btn-pdf" style="flex:1;">PDF bekijken</button>
 <button class="btn-blauw" id="arch-btn-resend" style="flex:1;">Opnieuw versturen</button>
 </div>
 `;
 document.getElementById('arch-btn-pdf').addEventListener('click', () => archiefBekijkPdf(w.id));
 document.getElementById('arch-btn-resend').addEventListener('click', () => archiefOpnieuwVersturen(w.id));
 document.getElementById('archief-detail').classList.add('on');
}
document.getElementById('btn-sluitarchief').addEventListener('click', () => document.getElementById('archief-detail').classList.remove('on'));

// Een al verzonden rapport laden in de (verborgen) formulierstaat, zonder de
// bewerkbare 5-stappen-vorm te tonen - we springen direct door naar de
// PDF- of email-weergave. Er wordt niets opgeslagen (save-inspection
// weigert wijzigingen aan afgeronde rapporten toch al met een 409).
async function laadArchiefInFormulier(id) {
 const res = await getInspectionRequest(id);
 if (!res.ok) { alert('Kon rapport niet laden.'); return false; }
 const rec = await res.json();
 setHuidigId(rec.id);
 vulFormulier(rec);
 document.getElementById('archief-detail').classList.remove('on');
 return true;
}
export async function archiefBekijkPdf(id) {
 try {
 if (await laadArchiefInFormulier(id)) openPDF();
 } catch(_) { alert('Kon rapport niet laden (netwerkfout).'); }
}
export async function archiefOpnieuwVersturen(id) {
 try {
 if (await laadArchiefInFormulier(id)) openEmail();
 } catch(_) { alert('Kon rapport niet laden (netwerkfout).'); }
}

export async function nieuweInspectie() {
 cancelPendingSave();
 try {
 const res = await saveInspectionRequest({});
 if (!res.ok) { alert('Kon geen nieuwe inspectie aanmaken.'); return; }
 const data = await res.json();
 setHuidigId(data.id);
 resetFormulier();
 document.getElementById('rapportnummer').value = data.rapportnummer;
 await serverSave();
 document.getElementById('dash').classList.remove('on');
 naarTab(0);
 } catch(_) { alert('Kon geen nieuwe inspectie aanmaken (netwerkfout).'); }
}

export async function laadInspectie(id) {
 cancelPendingSave();
 if (huidigId) await serverSave();
 try {
 const res = await getInspectionRequest(id);
 if (!res.ok) { alert('Kon inspectie niet laden.'); return; }
 const rec = await res.json();
 setHuidigId(rec.id);
 vulFormulier(rec);
 document.getElementById('dash').classList.remove('on');
 naarTab(0);
 } catch(_) { alert('Kon inspectie niet laden (netwerkfout).'); }
}

// Dashboard knoppen
document.getElementById('btn-dash').addEventListener('click', openDash);
document.getElementById('btn-sluitdash').addEventListener('click', sluitDash);
document.getElementById('btn-nieuw').addEventListener('click', nieuweInspectie);
