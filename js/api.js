// Centrale fetch-laag voor alle aanroepen naar de Netlify functions.
import { getSessionToken, _PS } from './auth.js';

// Wrapper rond fetch die het sessietoken meestuurt en bij een verlopen/ongeldige
// sessie (401) terugvalt naar het PIN-scherm, ongeacht welke aanroep dat trof.
export async function apiFetch(url, options={}) {
 const res = await fetch(url, { ...options, headers: { ...(options.headers||{}), 'X-Session-Token': getSessionToken() } });
 if (res.status === 401) {
 localStorage.removeItem(_PS);
 document.getElementById('dash').classList.remove('on');
 document.getElementById('archief-detail').classList.remove('on');
 const ps = document.getElementById('pin-screen');
 ps.style.cssText=''; ps.style.display='';
 }
 return res;
}

export async function verifyPinRequest(pin) {
  return fetch('/.netlify/functions/verify-pin',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pin})
  });
}

export async function listInspectionsRequest() {
 return apiFetch('/.netlify/functions/list-inspections');
}

export async function getInspectionRequest(id) {
 return apiFetch('/.netlify/functions/get-inspection?id=' + encodeURIComponent(id));
}

export async function saveInspectionRequest(payload) {
 return apiFetch('/.netlify/functions/save-inspection', {
 method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
 });
}

export async function ocrMeterRequest(payload) {
 return apiFetch('/.netlify/functions/ocr-meter', {
 method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
 });
}

// Let op: dit gebruikt bewust GEEN apiFetch (dus niet de gedeelde 401-afhandeling
// hierboven) - dat is ongewijzigd overgenomen gedrag uit de oorspronkelijke
// verstuur()-functie, die zijn eigen 401-check deed op de response. Zie form.js/pdf.js.
export async function sendEmailRequest(payload) {
  return fetch('/.netlify/functions/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': getSessionToken() },
    body: JSON.stringify(payload)
  });
}
