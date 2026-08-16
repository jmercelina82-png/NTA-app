// Test module load + JSON responses (geen echte email)
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-alleen-voor-dit-testscript';
const { handler } = require('./netlify/functions/send-email.js');
const { createSessionToken } = require('./netlify/functions/lib/_shared.js');

const ORIGIN = 'http://localhost:8888'; // valt onder de default ALLOWED_ORIGINS
const TOKEN = createSessionToken(process.env.SESSION_SECRET);

async function run() {
  console.log('=== Test 1: OPTIONS preflight ===');
  const r1 = await handler({ httpMethod: 'OPTIONS', headers: { origin: ORIGIN }, body: null });
  console.log('Status:', r1.statusCode, '| Body:', r1.body);
  console.assert(r1.statusCode === 200, 'OPTIONS moet 200 teruggeven');

  console.log('\n=== Test 2: GET geeft 405 ===');
  const r2 = await handler({ httpMethod: 'GET', headers: { origin: ORIGIN }, body: null });
  console.log('Status:', r2.statusCode, '| Body:', r2.body);
  console.assert(r2.statusCode === 405, 'GET moet 405 teruggeven');

  console.log('\n=== Test 3: POST zonder sessietoken wordt geweigerd ===');
  // Sinds de sessietoken-verplichting wordt dit al bij de auth-check geweigerd,
  // vóórdat de mail-credential-check ooit bereikt wordt (was voorheen 500).
  delete process.env.GMAIL_USER; delete process.env.GMAIL_PASS;
  const r3 = await handler({ httpMethod: 'POST', headers: { origin: ORIGIN }, body: JSON.stringify({ subject:'test', message:'hallo' }) });
  const d3 = JSON.parse(r3.body);
  console.log('Status:', r3.statusCode, '| Fout:', d3.error);
  console.assert(r3.statusCode === 401, 'POST zonder sessietoken moet 401 geven');

  console.log('\n=== Test 3b: POST met geldig token maar zonder mail-credentials ===');
  const r3b = await handler({ httpMethod: 'POST', headers: { origin: ORIGIN, 'x-session-token': TOKEN }, body: JSON.stringify({ subject:'test', message:'hallo' }) });
  const d3b = JSON.parse(r3b.body);
  console.log('Status:', r3b.statusCode, '| Fout:', d3b.error);
  console.assert(r3b.statusCode === 500 && d3b.error.includes('GMAIL_USER'), 'Met geldig token maar zonder credentials moet dit de credential-fout geven');

  console.log('\n=== Test 4: POST met kapot JSON body zonder sessietoken wordt geweigerd ===');
  // Zelfde reden als test 3: de auth-check gebeurt vóór het JSON parsen
  // (was voorheen 500 vanuit de JSON.parse-fout).
  const r4 = await handler({ httpMethod: 'POST', headers: { origin: ORIGIN }, body: 'GEEN_JSON' });
  const d4 = JSON.parse(r4.body);
  console.log('Status:', r4.statusCode, '| Fout:', d4.error);
  console.assert(r4.statusCode === 401, 'POST zonder sessietoken moet 401 geven, ook bij een kapot JSON-lichaam');

  console.log('\n=== Test 4b: POST met geldig token en kapot JSON body ===');
  const r4b = await handler({ httpMethod: 'POST', headers: { origin: ORIGIN, 'x-session-token': TOKEN }, body: 'GEEN_JSON' });
  const d4b = JSON.parse(r4b.body);
  console.log('Status:', r4b.statusCode, '| Fout:', d4b.error);
  console.assert(r4b.statusCode === 500, 'Met geldig token maar kapot JSON moet dit 500 geven');

  console.log('\n=== Test 5: POST met verkeerde origin wordt geweigerd ===');
  // De origin-check gebeurt vóór de sessie-check, dus dit blijft 403 - met
  // of zonder sessietoken maakt hier niets uit.
  const r5 = await handler({ httpMethod: 'POST', headers: { origin: 'https://kwaadaardige-site.example' }, body: JSON.stringify({ subject:'test' }) });
  const d5 = JSON.parse(r5.body);
  console.log('Status:', r5.statusCode, '| Fout:', d5.error);
  console.assert(r5.statusCode === 403, 'Onbekende origin moet 403 geven');

  console.log('\n✓ Alle tests geslaagd. Module laadt correct, JSON responses kloppen, sessie-/origin-check werkt.');
}
run().catch(e => { console.error('FOUT:', e); process.exit(1); });
