// 5-stappen-formulier: tab-navigatie, veldafhandeling, voortgangsberekening,
// handtekening. Eigenaar van de "huidige formulierstaat" (jnS/oor/alsList/
// rmList/con/fotos) - andere modules (autosave.js, pdf.js) lezen deze via de
// live export-bindingen hieronder.
import { huidigId } from './state.js';
import { cancelPendingSave, serverSave } from './autosave.js';
import { gv } from './utils.js';
import { triggerOcrSuggestie } from './ocr.js';

export let jnS={}, oor={}, alsList=[], rmList=[], con=null, fotos={};
let signing=false, sCtx=null;

// OORDEEL DATA
export const ELC=[
 {k:'ec1',t:'Isolatieweerstand totale installatie>1000× Un',s:'Blanke spanning voerende delen afgeschermd'},
 {k:'ec2',t:'Aardlekschakelaars gecontroleerd op aanspreekstroom en werking'},
 {k:'ec3',t:'Aardcircuitweerstand ongunstig punt gecontroleerd'},
 {k:'ec4',t:'Beschermingscontacten wandcontactdozen gecontroleerd'},
 {k:'ec5',t:'Installatie bad/doucheruimte centrale aardpunt gecontroleerd'},
 {k:'ec6',t:'Hoofd- en aanvullende potentiaalvereffening gecontroleerd'},
];
export const ELV=[
 {k:'ev1',t:'Bereikbaarheid bedienende elementen meterkast'},
 {k:'ev2',t:'Bescherming directe aanraking meterkast'},
 {k:'ev3',t:'Bescherming indirecte aanraking meterkast'},
 {k:'ev4',t:'Bescherming directe aanraking woning'},
 {k:'ev5',t:'Bescherming indirecte aanraking woning'},
 {k:'ev6',t:'Bescherming thermische invloeden'},
 {k:'ev7',t:'Elektrische gebruikersvoorziening bescherming el. schok'},
 {k:'ev8',t:'Uitvallen stroom veiligheidsvoorzieningen'},
];
export const WTV=[
 {k:'wv1',t:'Bereikbaarheid hoofdafsluiter'},
 {k:'wv2',t:'Ventilatie meterruimte'},
 {k:'wv3',t:'Toegepaste materialen juist en in goede staat'},
 {k:'wv4',t:'Beoordelen leidingwerk'},
 {k:'wv5',t:'Beoordelen tappunten en aansluitleidingen'},
 {k:'wv6',t:'Bescherming onbedoeld uitstromen'},
 {k:'wv7',t:'Bescherming verkeerd gebruik installatie'},
];
export const GSV=[
 {k:'gv1',t:'Ventilatie meterruimte'},
 {k:'gv2',t:'Toegepaste materialen juist en in goede staat'},
 {k:'gv3',t:'Aansluiting gasgebruikersvoorziening'},
 {k:'gv4',t:'Verbrandingsluchttoevoer, rookgasafvoer en ventilatieopeningen'},
 {k:'gv5',t:'Beheer gebruikersvoorziening'},
];

// TABS
export function naarTab(n) {
 document.querySelectorAll('.pg').forEach((p,i) => p.classList.toggle('on', i===n));
 document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('on', i===n));
 window.scrollTo(0,0);
 if (huidigId) { cancelPendingSave(); serverSave(); }
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', function(){ naarTab(parseInt(this.dataset.tab)); }));

// FOTOS - simpel via label/input, onchange handler
export function laadFoto(input, key) {
 const file = input.files[0];
 if (!file) return;
 const reader = new FileReader();
 reader.onload = e => {
 if (!fotos[key]) fotos[key] = [];
 fotos[key].push({ d: e.target.result, l: file.name.replace(/\.[^.]+$/,'') });
 const prev = document.getElementById('fp-' + key);
 if (prev) {
 const img = document.createElement('img');
 img.src = e.target.result;
 prev.appendChild(img);
 }
 triggerOcrSuggestie(key, e.target.result);
 // Foto's direct lokaal (+ server-sync poging) bewaren, niet wachten op de
 // gebruikelijke debounce - dit is het zwaarste/lastigst te herstellen
 // stukje data om kwijt te raken als de verbinding wegvalt.
 cancelPendingSave(); serverSave();
 };
 reader.readAsDataURL(file);
}

// OORDEEL BUILDER
export function buildOor(id, items) {
 const c = document.getElementById(id); if(!c) return;
 c.innerHTML = '';
 items.forEach(item => {
 const d = document.createElement('div'); d.className='oor-item';
 d.innerHTML = `
 <div class="oor-tekst">${item.t}${item.s?`<small>${item.s}</small>`:''}</div>
 <div class="oor-btns">
 <button class="ob" data-k="${item.k}" data-v="g">Geen</button>
 <button class="ob" data-k="${item.k}" data-v="e">Enig</button>
 <button class="ob" data-k="${item.k}" data-v="r">Ernstig</button>
 <button class="ob" data-k="${item.k}" data-v="n">NVT</button>
 </div>`;
 d.querySelectorAll('.ob').forEach(btn => btn.addEventListener('click', function(){
 oor[this.dataset.k] = this.dataset.v;
 this.closest('.oor-btns').querySelectorAll('.ob').forEach(b => b.className='ob');
 this.classList.add('on-'+this.dataset.v);
 }));
 c.appendChild(d);
 });
}

// JA/NEE
document.querySelectorAll('.jnb[data-g]').forEach(btn => btn.addEventListener('click', function(){
 const g=this.dataset.g, v=this.dataset.v;
 jnS[g]=v;
 this.closest('.jng').querySelectorAll('.jnb').forEach(b => b.className='jnb');
 this.classList.add(this.dataset.cls || 'on');
}));

// ALS
export function addALS() {
 alsList.push({s:'',t:'',tk:'JA'});
 const i = alsList.length - 1;
 const d = document.createElement('div'); d.className='als-item';
 d.innerHTML = `
 <div class="als-nr">Aardlekschakelaar 0${i+1}</div>
 <div class="g2">
 <div><label class="lb">Uitschakelstroom (mA)</label><input type="text" placeholder="20.0" data-als-idx="${i}" data-als-field="s"></div>
 <div><label class="lb">Uitschakeltijd (ms)</label><input type="text" placeholder="33.3" data-als-idx="${i}" data-als-field="t"></div>
 </div>
 <label class="lb">Testknop werkt</label>
 <div class="jng">
 <button class="jnb on" data-alsi="${i}" data-alsv="JA">JA</button>
 <button class="jnb" data-alsi="${i}" data-alsv="NEE" data-alscls="on-nee">NEE</button>
 </div>`;
 d.querySelectorAll('[data-als-field]').forEach(inp => inp.addEventListener('input', function(){
 alsList[parseInt(this.dataset.alsIdx)][this.dataset.alsField] = this.value;
 }));
 d.querySelectorAll('[data-alsv]').forEach(b => b.addEventListener('click', function(){
 const idx=parseInt(this.dataset.alsi), v=this.dataset.alsv;
 alsList[idx].tk=v;
 this.closest('.jng').querySelectorAll('.jnb').forEach(x=>x.className='jnb');
 this.classList.add(this.dataset.alscls||'on');
 }));
 document.getElementById('als-lijst').appendChild(d);
}

// ROOKMELDERS
export function addRM() {
 rmList.push({loc:'',oo:'g',werkt:'JA'});
 const i = rmList.length - 1;
 const d = document.createElement('div'); d.className='rm-item';
 d.innerHTML = `
 <div class="rm-nr">Rookmelder 0${i+1}</div>
 <label class="lb">Locatie / ruimte</label>
 <input type="text" placeholder="bijv. Hal / Gang / Slaapkamer" data-rm-idx="${i}" data-rm-field="loc" style="margin-bottom:10px;">
 <div class="g2">
 <div>
 <label class="lb">Oordeel</label>
 <div class="oor-btns">
 <button class="ob on-g" data-rmi="${i}" data-rmv="g">Geen</button>
 <button class="ob" data-rmi="${i}" data-rmv="e">Enig</button>
 <button class="ob" data-rmi="${i}" data-rmv="r">Ernstig</button>
 <button class="ob" data-rmi="${i}" data-rmv="n">NVT</button>
 </div>
 </div>
 <div>
 <label class="lb">Werkt (testknop)</label>
 <div class="jng">
 <button class="jnb on" data-rmwi="${i}" data-rmwv="JA">JA</button>
 <button class="jnb" data-rmwi="${i}" data-rmwv="NEE" data-rmwcls="on-nee">NEE</button>
 </div>
 </div>
 </div>`;
 d.querySelectorAll('[data-rm-field]').forEach(inp => inp.addEventListener('input', function(){
 rmList[parseInt(this.dataset.rmIdx)][this.dataset.rmField] = this.value;
 }));
 d.querySelectorAll('[data-rmi]').forEach(b => b.addEventListener('click', function(){
 const idx=parseInt(this.dataset.rmi), v=this.dataset.rmv;
 rmList[idx].oo=v;
 this.closest('.oor-btns').querySelectorAll('.ob').forEach(x=>x.className='ob');
 this.classList.add('on-'+v);
 }));
 d.querySelectorAll('[data-rmwi]').forEach(b => b.addEventListener('click', function(){
 const idx=parseInt(this.dataset.rmwi), v=this.dataset.rmwv;
 rmList[idx].werkt=v;
 this.closest('.jng').querySelectorAll('.jnb').forEach(x=>x.className='jnb');
 this.classList.add(this.dataset.rmwcls||'on');
 }));
 document.getElementById('rm-lijst').appendChild(d);
}

// CONCLUSIE
export function setCon(v) {
 con=v;
 ['g','e','r'].forEach(k=>document.getElementById('cb-'+k).className='con-btn');
 document.getElementById('cb-'+v).classList.add('on-'+v);
}

// HANDTEKENING
export function initSign() {
 const cv=document.getElementById('sgn'); if(!cv) return;
 sCtx=cv.getContext('2d');
 sCtx.strokeStyle='#1a4fa0'; sCtx.lineWidth=3; sCtx.lineCap='round';
 const pos=e=>{
 const r=cv.getBoundingClientRect();
 const s=e.touches?e.touches[0]:e;
 return{x:(s.clientX-r.left)*cv.width/r.width, y:(s.clientY-r.top)*cv.height/r.height};
 };
 cv.addEventListener('mousedown',e=>{signing=true;sCtx.beginPath();const p=pos(e);sCtx.moveTo(p.x,p.y);});
 cv.addEventListener('mousemove',e=>{if(!signing)return;const p=pos(e);sCtx.lineTo(p.x,p.y);sCtx.stroke();});
 cv.addEventListener('mouseup',()=>signing=false);
 cv.addEventListener('mouseleave',()=>signing=false);
 cv.addEventListener('touchstart',e=>{e.preventDefault();signing=true;sCtx.beginPath();const p=pos(e);sCtx.moveTo(p.x,p.y);},{passive:false});
 cv.addEventListener('touchmove',e=>{e.preventDefault();if(!signing)return;const p=pos(e);sCtx.lineTo(p.x,p.y);sCtx.stroke();},{passive:false});
 cv.addEventListener('touchend',()=>signing=false);
}
export function clearSign(){if(sCtx)sCtx.clearRect(0,0,800,240);}
export function getSign(){
 const cv=document.getElementById('sgn');if(!cv||!sCtx)return null;
 const d=sCtx.getImageData(0,0,cv.width,cv.height).data;
 if(!Array.from(d).some((v,i)=>i%4===3&&v>0))return null;
 return cv.toDataURL('image/png');
}

// VALIDATIE VOOR VERSTUREN/AFRONDEN
// Blokkeert versturen bij ontbrekende kernvelden, of bij een onveilig/ernstig-
// bezwaar-markering zonder toelichting (hergebruikt het bestaande "Aanvullende
// opmerkingen"-veld bij de eindconclusie - geen nieuw toelichtingsveld per
// controlepunt, dat zou voor de praktijk te streng worden). Springt naar de
// stap waar het ontbrekende veld hoort, in plaats van alleen een melding te tonen.
export function valideerVoorVersturen() {
 const heeftOnveilig = jnS['bescherming']==='ONVEILIG'
 || [...ELC,...ELV,...WTV,...GSV].some(it => oor[it.k]==='r');

 const controles = [
 {tab:0, ok:()=>!!gv('adres').trim(), melding:'Vul eerst het adres in voordat je verdergaat.'},
 {tab:0, ok:()=>!!gv('datum').trim(), melding:'Vul eerst de inspectiedatum in voordat je verdergaat.'},
 {tab:0, ok:()=>!!gv('inspecteur').trim(), melding:'Vul eerst de naam van de inspecteur in voordat je verdergaat.'},
 {tab:4, ok:()=>!!con, melding:'Kies eerst een eindconclusie (geen/enig/ernstig bezwaar) voordat je verdergaat.'},
 {tab:4, ok:()=>!heeftOnveilig||!!gv('con_opm').trim(), melding:'Er is een onderdeel als onveilig/ernstig bezwaar gemarkeerd - vul eerst een toelichting in bij "Aanvullende opmerkingen" voordat je verstuurt.'},
 {tab:4, ok:()=>!!getSign(), melding:'De handtekening van de inspecteur ontbreekt nog.'},
 ];
 for (const c of controles) {
 if (!c.ok()) { naarTab(c.tab); return {ok:false, melding:c.melding}; }
 }
 return {ok:true};
}

//
// OPSLAAN & HERVATTEN
//
const FLD = ['rapportnummer','adres','plaats','opdrachtgever','datum','inspecteur','mobiel',
 'ms1','ms2','msgas','meetpunt','zc','zc2','iso','vereef','rinnw','rcirc',
 'kw_t','ww_t','ci_t','water_opm','instr1','instr2','instr3','instr4','aft_dat','con_opm'];

export function leesFormulierData() {
 const f = {};
 FLD.forEach(id => { const el=document.getElementById(id); if(el) f[id]=el.value; });
 return {
 f, jnS: {...jnS}, oor: {...oor},
 als: alsList.map(a => ({...a})), rm: rmList.map(r => ({...r})), con,
 fotos: Object.fromEntries(Object.keys(fotos).map(k => [k, fotos[k].map(p => ({d:p.d, l:p.l}))]))
 };
}

// Voortgang per tab (Object/Elektra/Water/Gas/Einde) voor de dashboardweergave.
// Elektra/Water/Gas gelden als "bezig" zodra er een oordeel is vastgelegd
// (oor-keys ec*/ev* = elektra, wv* = water, gv* = gas, zie ELC/ELV/WTV/GSV).
export function berekenVoortgang() {
 const heeftOor = prefixes => Object.keys(oor).some(k => prefixes.some(p => k.startsWith(p)));
 return [
 !!gv('adres'),
 heeftOor(['ec','ev']),
 heeftOor(['wv']),
 heeftOor(['gv']),
 !!con
 ];
}

export function vulFormulier(w) {
 // Tekstvelden
 FLD.forEach(id => { const el=document.getElementById(id); if(el && w.f && w.f[id]!==undefined) el.value=w.f[id]; });
 // JA/NEE
 jnS = {...(w.jnS||{})};
 document.querySelectorAll('.jnb[data-g]').forEach(b => {
 const saved = jnS[b.dataset.g];
 b.className = 'jnb';
 if (saved && saved === b.dataset.v) b.classList.add(b.dataset.cls || 'on');
 });
 // Oordelen
 oor = {...(w.oor||{})};
 buildOor('el-checks',ELC); buildOor('el-vis',ELV);
 buildOor('water-vis',WTV); buildOor('gas-vis',GSV);
 // Herstel oordeel visueel
 Object.entries(oor).forEach(([k,v]) => {
 const btn = document.querySelector(`.ob[data-k="${k}"][data-v="${v}"]`);
 if (btn) { btn.closest('.oor-btns').querySelectorAll('.ob').forEach(b=>b.className='ob'); btn.classList.add('on-'+v); }
 });
 // ALS
 alsList = (w.als||[]).map(a=>({...a}));
 document.getElementById('als-lijst').innerHTML = '';
 alsList.forEach((_,i) => { alsList.length = i; addALS(); });
 alsList = (w.als||[]).map(a=>({...a}));
 // Sync invoer ALS
 document.querySelectorAll('#als-lijst .als-item').forEach((el,i) => {
 const ins = el.querySelectorAll('input[type=text]');
 if (ins[0]) ins[0].value = alsList[i]?.s || '';
 if (ins[1]) ins[1].value = alsList[i]?.t || '';
 });
 // Rookmelders
 rmList = (w.rm||[]).map(r=>({...r}));
 document.getElementById('rm-lijst').innerHTML = '';
 rmList.forEach((_,i) => { rmList.length = i; addRM(); });
 rmList = (w.rm||[]).map(r=>({...r}));
 document.querySelectorAll('#rm-lijst .rm-item').forEach((el,i) => {
 const inp = el.querySelector('input[type=text]');
 if (inp) inp.value = rmList[i]?.loc || '';
 });
 // Conclusie
 con = w.con || null;
 ['g','e','r'].forEach(k => { const b=document.getElementById('cb-'+k); if(b) b.className='con-btn'; });
 if (con) { const b=document.getElementById('cb-'+con); if(b) b.classList.add('on-'+con); }
 // Foto's herstellen
 fotos = {};
 Object.keys(w.fotos||{}).forEach(k => {
 fotos[k] = (w.fotos[k]||[]).map(f=>({d:f.d,l:f.l}));
 const prev = document.getElementById('fp-'+k);
 if (prev) {
 prev.innerHTML = '';
 fotos[k].forEach(f => { const img=document.createElement('img'); img.src=f.d; prev.appendChild(img); });
 }
 });
 // Handtekening wissen (kan niet herstellen zonder canvas data)
 if (sCtx) sCtx.clearRect(0,0,800,240);
}

export function resetFormulier() {
 FLD.forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
 const td2 = new Date().toISOString().slice(0,10);
 document.getElementById('datum').value = td2;
 document.getElementById('aft_dat').value = td2;
 document.getElementById('inspecteur').value = 'F. Bechoe';
 document.getElementById('mobiel').value = '0621555171';
 document.getElementById('plaats').value = 'Den Haag';
 document.getElementById('instr1').value = 'FLUKE 1662';
 document.getElementById('instr2').value = 'BLUELINE';
 jnS={}; oor={}; con=null; fotos={};
 document.querySelectorAll('.jnb[data-g]').forEach(b=>b.className='jnb');
 ['g','e','r'].forEach(k=>{const b=document.getElementById('cb-'+k);if(b)b.className='con-btn';});
 buildOor('el-checks',ELC); buildOor('el-vis',ELV);
 buildOor('water-vis',WTV); buildOor('gas-vis',GSV);
 document.getElementById('als-lijst').innerHTML='';
 alsList=[]; addALS();
 document.getElementById('rm-lijst').innerHTML='';
 rmList=[];
 addRM(); document.querySelector('#rm-lijst .rm-item input[type=text]').value='Hal'; rmList[0].loc='Hal';
 addRM(); document.querySelectorAll('#rm-lijst .rm-item input[type=text]')[1].value='Gang'; rmList[1].loc='Gang';
 if(sCtx) sCtx.clearRect(0,0,800,240);
 // Foto previews en state leegmaken
 fotos = {};
 ['voordeur','ms1','ms2','msgas','meterkast','water_l','water_a','gas_m','gas_k'].forEach(k=>{
 const p=document.getElementById('fp-'+k);
 if(p){p.innerHTML='';p.className='foto-preview';}
 const fi=document.getElementById('f-'+k);
 if(fi) fi.value='';
 });
}
