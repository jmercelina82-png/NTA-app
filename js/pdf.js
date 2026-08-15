// jsPDF-generatielogica, plus het versturen van het rapport (e-mail/WhatsApp) -
// die twee horen inhoudelijk samen (de PDF wordt als bijlage meegestuurd) en
// stonden ook in de oorspronkelijke index.html direct na elkaar.
import { jnS, oor, con, fotos, alsList, rmList, ELC, ELV, WTV, GSV, getSign } from './form.js';
import { gv, LOGO, comprimeerFotos } from './utils.js';
import { huidigId } from './state.js';
import { _PS } from './auth.js';
import { sendEmailRequest } from './api.js';
import { serverSave, cancelPendingSave } from './autosave.js';
import { verversDashboard } from './dashboard.js';

const VAST = 'Staedion.mutatie@rendon.nl';

// HELPERS (badge/HTML-fragmenten voor de PDF-tabellen)
function jnv(k){return jnS[k]||'';}
function pbg(v){ return pb(v); }
function pb(v){const m={g:'pbg',e:'pbe',r:'pbr',n:'pbn','':'pbn'};const l={g:'Geen bezwaar',e:'Enig bezwaar',r:'Ernstig bezwaar',n:'NVT','':''};return`<span class="p-badge ${m[v]||'pbn'}">${l[v]||v}</span>`;}
function jb(v){return`<span class="p-badge ${v==='JA'?'pbja':v==='NEE'?'pbne':'pbn'}">${v||''}</span>`;}
function oorRijen(items){return items.map(it=>`<tr><td>${it.t}${it.s?`<br><small style="color:#888">${it.s}</small>`:''}</td><td>${pb(oor[it.k]||'')}</td></tr>`).join('');}
function fotoRij(key,cap){const l=fotos[key];if(!l||!l.length)return'';return`<div class="p-fotos">${l.map(p=>`<img src="${p.d}" title="${p.l||cap}">`).join('')}</div>`;}
function meterFoto(k){const l=fotos[k];if(!l||!l.length)return'<td style="color:#aaa;font-size:10px;">Geen foto</td>';return`<td><img src="${l[0].d}" style="width:80px;height:58px;object-fit:cover;border:1px solid #ddd;border-radius:3px;"></td>`;}

// PDF - jsPDF native rendering (vectorkwaliteit, geen html2canvas)
export async function generatePDF() {
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const PW=210,PH=297,ML=14,MR=14,CW=182,HH=22,FY=285,CT=27,CB=281,RH=6.5;
  const BL=[30,95,191],LBL=[232,240,251];
  const cL=con==='g'?'GEEN BEZWAAR':con==='e'?'ENIG BEZWAAR':con==='r'?'ERNSTIG BEZWAAR':'NIET BEPAALD';
  const cC=con==='g'?[34,197,94]:con==='e'?[245,158,11]:[239,68,68];
  let pg=1;

  // Bepaal formaat uit data-URL
  const fmt=u=>(u||'').toLowerCase().includes('jpeg')||(u||'').toLowerCase().includes('jpg')?'JPEG':'PNG';

  // Afbeelding dimensies met behoud aspect ratio
  const iDim=(u,mw,mh)=>{
    try{const p=doc.getImageProperties(u);const ar=p.width/p.height;let w=mw,h=mw/ar;if(h>mh){h=mh;w=mh*ar;}return{w,h};}
    catch(_){return{w:mw,h:mh};}
  };

  // Header
  const hdr=(sub='Rapportage NTA 8025')=>{
    doc.setFillColor(...BL);doc.rect(0,0,PW,HH,'F');
    doc.setFillColor(255,255,255);doc.roundedRect(ML,3,16,16,1.5,1.5,'F');
    if(typeof LOGO!=='undefined'&&LOGO){try{doc.addImage(LOGO,'PNG',ML+1,4,14,14);}catch(_){}}
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('FSB Onderhoudsbedrijf BV',ML+20,10);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(sub+' \xb7 NEN-8025:2018 nl',ML+20,16);
    doc.setFontSize(7);doc.text('Pagina '+pg,PW-MR,16,{align:'right'});
    doc.setTextColor(0,0,0);
  };

  // Footer
  const ftr=()=>{
    doc.setFillColor(...BL);doc.rect(0,FY,PW,PH-FY,'F');
    doc.setTextColor(255,255,255);doc.setFont('helvetica','normal');doc.setFontSize(7);
    doc.text('FSB Onderhoudsbedrijf BV  \xb7  Lulofstraat 52, Den Haag  \xb7  '+gv('inspecteur')+'  \xb7  '+gv('mobiel'),ML,FY+5);
    doc.text(new Date().toLocaleDateString('nl-NL'),PW-MR,FY+5,{align:'right'});
    doc.setTextColor(0,0,0);
  };

  const newPg=(sub)=>{ftr();doc.addPage();pg++;hdr(sub);};
  const chk=(y,n=8)=>{if(y+n>CB){newPg();return CT;}return y;};

  // Sectietitel
  const sec=(t,y)=>{
    y=chk(y,10);
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...BL);
    doc.text(t.toUpperCase(),ML,y+4);
    doc.setDrawColor(...BL);doc.setLineWidth(0.4);doc.line(ML,y+5,PW-MR,y+5);
    doc.setTextColor(0,0,0);doc.setDrawColor(0,0,0);
    return y+9;
  };

  // Gekleurde badge voor oordeel
  const oBdg=(v,x,y,w)=>{
    const C={g:[34,197,94],e:[245,158,11],r:[239,68,68],n:[148,163,184],'':[200,200,200]};
    const L={g:'Geen bezwaar',e:'Enig bezwaar',r:'Ernstig bezwaar',n:'NVT','':'-'};
    doc.setFillColor(...(C[v]||C['']));
    doc.roundedRect(x+0.5,y-3.8,w-1,5,0.8,0.8,'F');
    doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(6.5);
    doc.text(L[v]||v||'-',x+w/2,y,{align:'center'});
    doc.setTextColor(0,0,0);
  };

  // Tabel 2 kolommen, optioneel badge in laatste kolom
  const tbl=(hdrs,rows,y,cws,bdgLast=false)=>{
    const tw=cws.reduce((a,b)=>a+b,0);
    y=chk(y,RH+2);
    doc.setFillColor(...LBL);doc.rect(ML,y,tw,RH,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...BL);
    let x=ML;
    hdrs.forEach((h,i)=>{
      doc.text(h,x+2,y+4.5);
      doc.setDrawColor(180,200,240);doc.setLineWidth(0.3);doc.rect(x,y,cws[i],RH);
      x+=cws[i];
    });
    doc.setTextColor(0,0,0);y+=RH;
    rows.forEach((row,ri)=>{
      y=chk(y,RH);
      if(ri%2===0){doc.setFillColor(250,251,255);doc.rect(ML,y,tw,RH,'F');}
      x=ML;
      row.forEach((cell,ci)=>{
        const last=ci===row.length-1;
        const isO=['g','e','r','n',''].includes(String(cell));
        if(ci===0){doc.setFillColor(245,247,255);doc.rect(x,y,cws[ci],RH,'F');doc.setFont('helvetica','bold');doc.setTextColor(...BL);}
        else{doc.setFont('helvetica','normal');doc.setTextColor(30,30,30);}
        doc.setFontSize(7.5);
        if(bdgLast&&last&&isO){oBdg(String(cell),x,y+4.5,cws[ci]);}
        else{const s=String(cell||'');const mc=Math.floor(cws[ci]/1.85);doc.text(s.length>mc?s.slice(0,mc-2)+'..':s,x+2,y+4.5);}
        doc.setDrawColor(220,220,220);doc.setLineWidth(0.2);doc.rect(x,y,cws[ci],RH);
        x+=cws[ci];
      });
      doc.setTextColor(0,0,0);y+=RH;
    });
    return y+2;
  };

  // 4-kolom tabel (label-waarde paren)
  const tbl4=(rows,y,cws)=>{
    rows.forEach((row,ri)=>{
      y=chk(y,RH);
      if(ri%2===0){doc.setFillColor(250,251,255);doc.rect(ML,y,CW,RH,'F');}
      let x=ML;
      row.forEach((cell,ci)=>{
        const lbl=ci===0||ci===2;
        if(lbl){doc.setFillColor(245,247,255);doc.rect(x,y,cws[ci],RH,'F');doc.setFont('helvetica','bold');doc.setTextColor(...BL);}
        else{doc.setFont('helvetica','normal');doc.setTextColor(30,30,30);}
        doc.setFontSize(7.5);doc.text(String(cell||''),x+2,y+4.5);
        doc.setDrawColor(220,220,220);doc.setLineWidth(0.2);doc.rect(x,y,cws[ci],RH);
        x+=cws[ci];
      });
      doc.setTextColor(0,0,0);y+=RH;
    });
    return y+3;
  };

  // Foto rij met correcte aspect ratio (max 4 fotos per rij)
  const fotorij=(keys,y,maxH=38)=>{
    const all=[];
    (keys||[]).forEach(k=>{if(fotos[k])fotos[k].forEach(p=>all.push(p));});
    if(!all.length)return y;
    const cnt=Math.min(all.length,4);
    const fw=(CW-(cnt-1)*3)/cnt;
    y=chk(y,maxH+5);
    let x=ML;
    all.slice(0,4).forEach(p=>{
      const{w,h}=iDim(p.d,fw,maxH);
      try{doc.addImage(p.d,fmt(p.d),x,y,w,h);doc.setDrawColor(200,200,200);doc.setLineWidth(0.3);doc.rect(x,y,w,h);}catch(_){}
      x+=fw+3;
    });
    return y+maxH+5;
  };

  // ============ PAGINA 1: VOORBLAD ============
  hdr();let y=CT;

  if(fotos['voordeur']&&fotos['voordeur'].length){
    const vd=fotos['voordeur'][0];
    const{w,h}=iDim(vd.d,CW,78);
    const xc=ML+(CW-w)/2;
    try{doc.addImage(vd.d,fmt(vd.d),xc,y,w,h);}catch(_){}
    doc.setDrawColor(200,200,200);doc.setLineWidth(0.3);doc.rect(xc,y,w,h);
    y+=h+5;
  }

  y=tbl4([
    ['Uitvoerend partij','FSB Onderhoudsbedrijf BV','Inspecteur',gv('inspecteur')+' | '+gv('mobiel')],
    ['Kantoor','Lulofstraat 52, Den Haag','Rapportnr.',gv('rapportnummer')||'-'],
    ['Object','Woning','Datum keuring',gv('datum')],
    ['Adres',gv('adres')+', '+gv('plaats'),'Opdrachtgever',gv('opdrachtgever')],
  ],y,[34,57,34,57]);

  y=chk(y,16);
  doc.setFillColor(...cC);doc.rect(ML,y,CW,14,'F');
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(13);
  doc.text('Eindoordeel: '+cL,PW/2,y+9,{align:'center'});
  doc.setTextColor(0,0,0);

  ftr();

  // ============ PAGINA 2: AANKONDIGING ============
  doc.addPage();pg++;hdr('Toelichting beoordeling');y=CT;
  y=sec('Aankondiging & Toelichting',y);
  doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(30,30,30);
  const intro='Voor u ligt het resultaat van de beoordeling van de veiligheid van de technische installaties in de woning '+gv('adres')+', '+gv('plaats')+', uitgevoerd op '+gv('datum')+' door '+gv('inspecteur')+'.\n\nDe beoordeling is uitgevoerd conform de NEN-8025:2018 norm. Het doel is geconstateerde tekortkomingen inzichtelijk te maken en adviezen te geven hoe deze kunnen worden verholpen.';
  doc.splitTextToSize(intro,CW).forEach(l=>{y=chk(y,5);doc.text(l,ML,y);y+=4.5;});
  y+=5;

  [{title:'Geen bezwaar',clr:[34,197,94],bg:[220,252,231],tc:[21,128,61],
    txt:'Het gebruik kan veilig plaatsvinden. Er zijn geen gebreken die het veilig gebruik in de weg staan.'},
   {title:'Enig bezwaar',clr:[245,158,11],bg:[254,243,199],tc:[146,102,11],
    txt:'Bij gebruik ontstaat in enige mate gevaar. Er is ook een advies gegeven hoe het bezwaar kan worden weggenomen door reparatie, wijziging, herstel of vervanging van de installatie.'},
   {title:'Ernstig bezwaar',clr:[239,68,68],bg:[254,226,226],tc:[185,28,28],
    txt:'Er is sprake van acuut (levensbedreigend) gevaar. Het gevaar dient direct te worden verholpen. Maak geen gebruik meer van de installatie totdat het gevaar is opgeheven.'},
  ].forEach(box=>{
    const wt=doc.splitTextToSize(box.txt,CW-12);
    const bh=9+wt.length*4.5+3;
    y=chk(y,bh+3);
    doc.setFillColor(...box.bg);doc.roundedRect(ML,y,CW,bh,2,2,'F');
    doc.setFillColor(...box.clr);doc.rect(ML,y,4,bh,'F');
    doc.setTextColor(...box.tc);doc.setFont('helvetica','bold');doc.setFontSize(9.5);
    doc.text(box.title,ML+7,y+7);
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);
    wt.forEach((l,i)=>doc.text(l,ML+7,y+13+(i*4.5)));
    doc.setTextColor(0,0,0);y+=bh+4;
  });

  y+=2;y=chk(y,13);
  doc.setFillColor(...cC);doc.rect(ML,y,CW,11,'F');
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(11);
  doc.text('Eindoordeel: '+cL,PW/2,y+8,{align:'center'});
  doc.setTextColor(0,0,0);
  ftr();

  // ============ PAGINA 3+: TECHNISCH RAPPORT ============
  doc.addPage();pg++;hdr('Technisch rapport');y=CT;

  y=sec('Meterstanden',y);
  y=tbl(['Omschrijving','Waarde'],[
    ['Meterstand 1 â€” Laag Tarief',gv('ms1')||'-'],
    ['Meterstand 2 â€” Hoog Tarief',gv('ms2')||'-'],
    ['Meterstand Gas (mÂ³)',gv('msgas')||'-'],
  ],y,[130,52]);
  y=fotorij(['ms1','ms2','msgas'],y,30);

  y=sec('Aarding & bescherming',y);
  y=tbl4([
    ['Bescherming el. schok',jnS['bescherming']||'-','Waterleiding geaard',jnS['wg']||'-'],
    ['Gasleiding geaard',jnS['gg']||'-','KW badkamer geaard',jnS['kwg']||'-'],
    ['Radiator badkamer geaard',jnS['rg']||'-','CAP badkamer',jnS['cap']||'-'],
  ],y,[52,24,58,48]);
  y=fotorij(['meterkast'],y,45);

  y=sec('1. Elektrische installatie â€” Technische controles',y);
  y=tbl(['Controlepunt','Oordeel'],ELC.map(it=>[it.t+(it.s?' ('+it.s+')':''),oor[it.k]||'']),y,[148,34],true);

  y=sec('Meetwaarden elektrische installatie',y);
  y=tbl(['Parameter','Waarde'],[
    ['Punt van meting',gv('meetpunt')||'-'],
    ['Rinwendig (Î©)',gv('rinnw')||'-'],
    ['Rcircuit (Î©)',gv('rcirc')||'-'],
    ['Zc (Î©)',gv('zc')||'-'],
    ['Zc fase-beveiliging (Î©)',gv('zc2')||'-'],
    ['Isolatieweerstand (MÎ©)',gv('iso')||'-'],
    ['Weerstand bescherming (Î©)',gv('vereef')||'-'],
  ],y,[130,52]);

  y=sec('Aardlekschakelaar(s)',y);
  if(alsList.length){
    y=tbl(['Nr.','Uitschakelstroom (mA)','Uitschakeltijd (ms)','Testknop'],
      alsList.map((a,i)=>['0'+(i+1),a.s||'-',a.t||'-',a.tk||'-']),y,[20,60,60,42]);
  }else{y=chk(y,7);doc.setFont('helvetica','italic');doc.setFontSize(7.5);doc.setTextColor(150,150,150);doc.text('Geen aardlekschakelaars ingevoerd.',ML,y+4);doc.setTextColor(0,0,0);y+=8;}

  y=sec('Visuele beoordeling elektrische installatie',y);
  y=tbl(['Aspect','Oordeel'],ELV.map(it=>[it.t,oor[it.k]||'']),y,[148,34],true);

  y=sec('2. Rookmelders',y);
  if(rmList.length){
    const rCws=[18,82,48,34],rTw=rCws.reduce((a,b)=>a+b,0);
    y=chk(y,RH+2);
    doc.setFillColor(...LBL);doc.rect(ML,y,rTw,RH,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...BL);
    let rx=ML;
    ['Nr.','Locatie','Oordeel','Werkt'].forEach((h,i)=>{
      doc.text(h,rx+2,y+4.5);doc.setDrawColor(180,200,240);doc.setLineWidth(0.3);doc.rect(rx,y,rCws[i],RH);rx+=rCws[i];
    });
    doc.setTextColor(0,0,0);y+=RH;
    rmList.forEach((r,ri)=>{
      y=chk(y,RH);
      if(ri%2===0){doc.setFillColor(250,251,255);doc.rect(ML,y,rTw,RH,'F');}
      rx=ML;
      ['0'+(ri+1),r.loc||'-',r.oo||'',r.werkt||'-'].forEach((cell,ci)=>{
        if(ci===0){doc.setFillColor(245,247,255);doc.rect(rx,y,rCws[ci],RH,'F');doc.setFont('helvetica','bold');doc.setTextColor(...BL);}
        else{doc.setFont('helvetica','normal');doc.setTextColor(30,30,30);}
        doc.setFontSize(7.5);
        if(ci===2){oBdg(String(cell),rx,y+4.5,rCws[ci]);}
        else{doc.text(String(cell||''),rx+2,y+4.5);}
        doc.setDrawColor(220,220,220);doc.setLineWidth(0.2);doc.rect(rx,y,rCws[ci],RH);rx+=rCws[ci];
      });
      doc.setTextColor(0,0,0);y+=RH;
    });
    y+=2;
  }else{y=chk(y,7);doc.setFont('helvetica','italic');doc.setFontSize(7.5);doc.setTextColor(150,150,150);doc.text('Geen rookmelders ingevoerd.',ML,y+4);doc.setTextColor(0,0,0);y+=8;}

  y=fotorij(['water_l','water_a'],y,40);
  y=sec('3. Leidingwaterinstallatie',y);
  y=tbl(['Aspect','Oordeel'],WTV.map(it=>[it.t,oor[it.k]||'']),y,[148,34],true);
  y=sec('Temperatuurmetingen & water',y);
  y=tbl4([
    ['Koudwater (Â°C)',gv('kw_t')||'-','Circulerend systeem',jnS['circ']||'-'],
    ['Warmwater (Â°C)',gv('ww_t')||'-','Voorraadvat',jnS['vv']||'-'],
    ['Circulatie (Â°C)',gv('ci_t')||'-','Opmerking',gv('water_opm')||'-'],
  ],y,[52,24,58,48]);

  y=fotorij(['gas_m','gas_k'],y,40);
  y=sec('4. Gasinstallatie',y);
  y=tbl(['Aspect','Oordeel'],GSV.map(it=>[it.t,oor[it.k]||'']),y,[148,34],true);

  y=sec('Meetinstrumenten',y);
  const instrR=[];
  for(let n=1;n<=4;n++){const v=gv('instr'+n);if(v&&v.trim())instrR.push([String(n),v]);}
  if(!instrR.find(r=>r[0]==='1'))instrR.unshift(['1','FLUKE 1662']);
  y=tbl(['Nr.','Instrument'],instrR,y,[18,164]);

  y=chk(y,45);
  y=sec('Conclusie',y);
  doc.setFillColor(...cC);doc.rect(ML,y,CW,11,'F');
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(11);
  doc.text('Afgetekend: '+gv('aft_dat')+'  |  '+cL,PW/2,y+8,{align:'center'});
  doc.setTextColor(0,0,0);y+=14;
  if(gv('con_opm')&&gv('con_opm')!=='-'){
    y=chk(y,7);doc.setFont('helvetica','italic');doc.setFontSize(8);doc.setTextColor(80,80,80);
    doc.text('Opmerking: '+gv('con_opm'),ML,y);doc.setTextColor(0,0,0);y+=7;
  }

  // Handtekening inspecteur (geen "Voor gezien opdrachtgever")
  y=chk(y,32);
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...BL);
  doc.text('Handtekening inspecteur',ML,y);
  doc.setDrawColor(...BL);doc.setLineWidth(0.5);doc.line(ML,y+18,ML+80,y+18);
  const sg=getSign();
  if(sg){try{const sp=doc.getImageProperties(sg);const sw=55,sh=sw*(sp.height/sp.width);doc.addImage(sg,'PNG',ML,y+2,sw,Math.min(sh,16));}catch(_){}}
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(50,50,50);
  doc.text(gv('inspecteur')+' | '+gv('mobiel'),ML,y+23);
  doc.setTextColor(0,0,0);

  ftr();
  return doc;
}

export function openPDF(){
  generatePDF().then(doc=>{
    const url=URL.createObjectURL(doc.output('blob'));
    const pdoc=document.getElementById('pdoc');
    pdoc.style.cssText='padding:0;max-width:100%;background:transparent;margin:0;';
    pdoc.innerHTML='<iframe src="'+url+'#toolbar=0&navpanes=0" style="width:100%;height:calc(100vh - 56px);border:none;display:block;" title="PDF"></iframe>';
    document.getElementById('pov').classList.add('on');
  }).catch(e=>{console.error('PDF fout:',e);alert('PDF fout: '+e.message);});
}

export function sluitPDF(){document.getElementById('pov').classList.remove('on');}
export async function downloadPDF(){
  const doc=await generatePDF();
  const adres=(gv('adres')||'rapport').replace(/\s+/g,'-');
  const datum=gv('datum')||new Date().toISOString().slice(0,10);
  doc.save('FSB_NTA8025_'+adres+'_'+datum+'.pdf');
}

// EMAIL
export function openEmail(){
 document.getElementById('eml-sub').value=`FSB NTA 8025 ${gv('rapportnummer')} ${gv('adres')} ${gv('datum')}`;
 const cL=con==='g'?'GEEN BEZWAAR':con==='e'?'ENIG BEZWAAR':con==='r'?'ERNSTIG BEZWAAR':'NIET BEPAALD';
 document.getElementById('eml-body').value=`Geachte heer/mevrouw,

Hierbij het NTA 8025 rapport van FSB Onderhoudsbedrijf BV.

Adres: ${gv('adres')}, ${gv('plaats')}
Datum: ${gv('datum')}
Inspecteur: ${gv('inspecteur')} | ${gv('mobiel')}
Eindoordeel: ${cL}

Het rapport is als PDF bijgevoegd.

Met vriendelijke groet,
${gv('inspecteur')}
FSB Onderhoudsbedrijf BV`;
 document.getElementById('eml-st').style.display='none';
 document.getElementById('btn-dosend').disabled=false;
 document.getElementById('btn-dosend').textContent=' Verstuur';
 document.getElementById('eml-na-verzenden').style.display='none';
 document.getElementById('eml-acties').style.display='flex';
 document.getElementById('eml').classList.add('on');
}
export function sluitEmail(){ document.getElementById('eml').classList.remove('on'); }
export function naarDashboardNaVerzenden(){
 sluitEmail();
 document.getElementById('btn-sluitdash').style.display = huidigId ? '' : 'none';
 document.getElementById('dash').classList.add('on');
 verversDashboard();
}
document.getElementById('btn-na-verzenden-dash').addEventListener('click', naarDashboardNaVerzenden);
export async function verstuur(){
  const btn = document.getElementById('btn-dosend');
  const st  = document.getElementById('eml-st');
  btn.disabled = true;
  btn.textContent = 'Bezig...';
  st.style.cssText = 'display:block;padding:12px;border-radius:8px;margin-bottom:10px;font-size:13px;background:#e8f0fb;color:#1a4fa0;font-weight:600;';
  st.textContent = 'Verbinding maken...';

  const subject = document.getElementById('eml-sub').value;
  const message = document.getElementById('eml-body').value;

  try {
    // Zorg dat de laatste wijzigingen opgeslagen zijn voordat we versturen
    if (huidigId) { cancelPendingSave(); await serverSave(); }

    // Eerst PDF proberen te genereren
    let pdfBase64 = null;
    let fn = 'FSB_rapport.pdf';
    try {
      // Comprimeer fotos naar 480px JPEG 60% voor kleine email-bijlage (blijft onder Netlify 6MB)
      const origFotos=fotos;
      const gecomprimeerd = await comprimeerFotos(fotos,480,0.60);
      Object.keys(fotos).forEach(k => delete fotos[k]);
      Object.assign(fotos, gecomprimeerd);
      let pdfDoc;
      try{pdfDoc=await generatePDF();}finally{Object.keys(fotos).forEach(k => delete fotos[k]);Object.assign(fotos, origFotos);}
      pdfBase64=pdfDoc.output('datauristring').split(',')[1];
      // Laatste veiligheidscontrole: als PDF nog steeds >4.5MB, stuur zonder bijlage
      if(pdfBase64&&pdfBase64.length>4500000){
        console.warn('Email PDF te groot na compressie ('+Math.round(pdfBase64.length/1024)+'KB), verstuurd zonder bijlage');
        pdfBase64=null;
      }
      const adres=gv('adres').replace(/\s+/g,'-');
      const datum=gv('datum')||new Date().toISOString().slice(0,10);
      fn='FSB_NTA8025_'+adres+'_'+datum+'.pdf';
    }catch(pdfErr){console.warn('PDF generatie fout:',pdfErr);}

    // Verstuur via Netlify functie (met of zonder PDF)
    const res = await sendEmailRequest({
      subject: subject || 'FSB Test',
      message: message || 'Test bericht',
      pdfBase64: pdfBase64,
      filename: fn,
      id: huidigId
    });

    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch(_) {}

    if (res.ok && data.success) {
      st.style.cssText = 'display:block;padding:12px;border-radius:8px;margin-bottom:10px;font-size:13px;background:#e8f5e9;color:#1a7a3d;font-weight:700;';
      st.textContent = 'Email verzonden naar Staedion + CC naar jou! De inspectie staat nu bij Afgerond.';
      btn.textContent = 'Verzonden!';
      document.getElementById('eml-acties').style.display = 'none';
      document.getElementById('eml-na-verzenden').style.display = 'block';
    } else {
      if (res.status === 401) {
        localStorage.removeItem(_PS);
        document.getElementById('pin-screen').style.cssText = '';
      }
      const detail = data.error || (text ? text.slice(0, 150) : '');
      throw new Error(`Server fout ${res.status}${detail ? ': ' + detail : ''}`);
    }
  } catch(err) {
    st.style.cssText = 'display:block;padding:12px;border-radius:8px;margin-bottom:10px;font-size:13px;background:#fde;color:#721c24;font-weight:600;';
    st.textContent = 'Fout: ' + err.message;
    btn.disabled = false;
    btn.textContent = 'Email + PDF';
  }
}

export async function verstuurWhatsApp(){
  const adres = gv('adres');
  const datum = gv('datum') || new Date().toISOString().slice(0,10);
  const fn    = 'FSB_NTA8025_' + adres.replace(/\s+/g,'-') + '_' + datum + '.pdf';
  const cL    = con==='g'?'GEEN BEZWAAR':con==='e'?'ENIG BEZWAAR':con==='r'?'ERNSTIG BEZWAAR':'NIET BEPAALD';
  const tekst = 'FSB NTA 8025 Rapport\n\nAdres: ' + adres + ', ' + gv('plaats') +
                '\nDatum: ' + datum + '\nInspecteur: ' + gv('inspecteur') +
                '\nEindoordeel: ' + cL;
  const st = document.getElementById('eml-st');

  const toonStatus = (msg, ok=true) => {
    st.style.cssText = 'display:block;padding:12px;border-radius:8px;margin-bottom:10px;font-size:13px;line-height:1.6;font-weight:600;'
      + (ok ? 'background:#e8f5e9;color:#1a7a3d;' : 'background:#fde;color:#721c24;');
    st.innerHTML = msg;
  };

  toonStatus('PDF wordt gegenereerd...');

  try {
    const doc = await generatePDF();
    const blob = doc.output('blob');

    // Pad 1: Web Share API — werkt op Android/iOS Chrome/Safari, deelt PDF direct als bestand
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], fn, { type: 'application/pdf' })] })) {
      const file = new File([blob], fn, { type: 'application/pdf' });
      try {
        await navigator.share({ files: [file], title: 'FSB NTA 8025 Rapport', text: tekst });
        toonStatus('PDF gedeeld via Web Share!');
        return;
      } catch(shareErr) {
        // Gebruiker heeft geannuleerd of share mislukt — val terug op download
        if (shareErr.name === 'AbortError') { st.style.display='none'; return; }
        // Andere fout: ga verder met fallback
      }
    }

    // Pad 2: Fallback — download PDF + open WhatsApp web met tekst
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fn; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    toonStatus('PDF gedownload als <strong>' + fn + '</strong><br>WhatsApp opent — voeg de PDF toe via de paperclip.');
    setTimeout(() => {
      window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
    }, 1000);

  } catch(err) {
    toonStatus('Fout: ' + err.message, false);
  }
}

// PDF knop header
document.getElementById('btn-pdf-hdr').addEventListener('click', openPDF);
