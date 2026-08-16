// ============ PIN AUTHENTICATIE ============
// De pincode wordt server-side gecontroleerd door de verify-pin functie (env var APP_PIN).
import { LOGO } from './utils.js';
import { toonDashboardNaLogin } from './dashboard.js';
import { verifyPinRequest } from './api.js';

export const _PS = 'fsb_session';
let _pi = '';
(function _pinInit(){
  const s = localStorage.getItem(_PS);
  if(s){try{const{t}=JSON.parse(s);if((Date.now()-t)/3600000<8){document.getElementById('pin-screen').style.display='none';toonDashboardNaLogin();return;}}catch(_){}}
})();
export function pinKey(k){if(_pi.length>=4)return;_pi+=k;_pinDots();if(_pi.length===4)setTimeout(_pinVerify,80);}
export function pinDel(){_pi=_pi.slice(0,-1);_pinDots();}
function _pinDots(){document.querySelectorAll('.pin-dot').forEach((d,i)=>d.classList.toggle('on',i<_pi.length));}
function _pinFail(msg){
  document.getElementById('pin-err').textContent=msg||'Verkeerde pincode, probeer opnieuw';
  const d=document.getElementById('pin-dots');d.classList.add('pin-shake');
  setTimeout(()=>{d.classList.remove('pin-shake');_pi='';_pinDots();document.getElementById('pin-err').textContent='';},500);
}
async function _pinVerify(){
  const attempt=_pi;
  try{
    const res=await verifyPinRequest(attempt);
    const data=await res.json().catch(()=>({}));
    if(res.ok&&data.success&&data.token){
      localStorage.setItem(_PS,JSON.stringify({token:data.token,t:Date.now()}));
      const el=document.getElementById('pin-screen');
      el.style.transition='opacity .3s';el.style.opacity='0';
      setTimeout(()=>el.style.display='none',300);
      toonDashboardNaLogin();
    }else{
      _pinFail(data.error);
    }
  }catch(err){
    _pinFail('Verbindingsfout, probeer opnieuw');
  }
}

document.getElementById('pin-logo').src = LOGO;
document.getElementById('dh-logo').src = LOGO;

export function getSessionToken() {
 try { return JSON.parse(localStorage.getItem(_PS)||'{}').token || ''; } catch(_) { return ''; }
}
