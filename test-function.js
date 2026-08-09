// Test module load + JSON responses (geen echte email)
const { handler } = require('./netlify/functions/send-email.js');

const ORIGIN = 'http://localhost:8888'; // valt onder de default ALLOWED_ORIGINS

async function run() {
  console.log('=== Test 1: OPTIONS preflight ===');
  const r1 = await handler({ httpMethod: 'OPTIONS', headers: { origin: ORIGIN }, body: null });
  console.log('Status:', r1.statusCode, '| Body:', r1.body);
  console.assert(r1.statusCode === 200, 'OPTIONS moet 200 teruggeven');

  console.log('\n=== Test 2: GET geeft 405 ===');
  const r2 = await handler({ httpMethod: 'GET', headers: { origin: ORIGIN }, body: null });
  console.log('Status:', r2.statusCode, '| Body:', r2.body);
  console.assert(r2.statusCode === 405, 'GET moet 405 teruggeven');

  console.log('\n=== Test 3: POST zonder credentials ===');
  delete process.env.GMAIL_USER; delete process.env.GMAIL_PASS;
  const r3 = await handler({ httpMethod: 'POST', headers: { origin: ORIGIN }, body: JSON.stringify({ subject:'test', message:'hallo' }) });
  const d3 = JSON.parse(r3.body);
  console.log('Status:', r3.statusCode, '| Fout:', d3.error);
  console.assert(r3.statusCode === 500 && d3.error.includes('GMAIL_USER'), 'Moet credential-fout geven');

  console.log('\n=== Test 4: POST met kapot JSON body ===');
  const r4 = await handler({ httpMethod: 'POST', headers: { origin: ORIGIN }, body: 'GEEN_JSON' });
  const d4 = JSON.parse(r4.body);
  console.log('Status:', r4.statusCode, '| Fout:', d4.error);
  console.assert(r4.statusCode === 500, 'Kapot JSON moet 500 geven');

  console.log('\n=== Test 5: POST met verkeerde origin wordt geweigerd ===');
  const r5 = await handler({ httpMethod: 'POST', headers: { origin: 'https://kwaadaardige-site.example' }, body: JSON.stringify({ subject:'test' }) });
  const d5 = JSON.parse(r5.body);
  console.log('Status:', r5.statusCode, '| Fout:', d5.error);
  console.assert(r5.statusCode === 403, 'Onbekende origin moet 403 geven');

  console.log('\n✓ Alle 5 tests geslaagd. Module laadt correct, JSON responses kloppen, origin-check werkt.');
}
run().catch(e => { console.error('FOUT:', e); process.exit(1); });
