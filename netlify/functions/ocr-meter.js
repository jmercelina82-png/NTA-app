const Anthropic = require('@anthropic-ai/sdk');
const {
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimitFailClosed,
  hasValidSession,
  connectBlobs
} = require('./lib/_shared');

const MAX_BODY_LEN = 3_000_000;
const MAX_FOTO_BASE64_LEN = 2_500_000; // ruim boven een gecomprimeerde foto (comprimeerFotos: ~480px, kwaliteit 0.60)
const RATE_LIMIT_MAX = 200;           // meterfoto's triggeren automatisch OCR, dus hoger dan handmatige acties...
const RATE_LIMIT_WINDOW_MS = 3600000; // ...per uur per IP

// Generiek opgezet met een metertype-parameter zodat latere uitbreiding (elektra
// laag/hoog tarief, CV-ketel typeplaatje) geen herontwerp vergt - v1 implementeert
// alleen het gaspad, de rest geeft een nette "nog niet ondersteund"-fout.
const PROMPTS = {
  gas: "Je krijgt een foto van een Nederlandse gasmeter. Lees de meterstand af zoals die op de teller wordt getoond (een getal, waarbij de laatste 1-3 cijfers vaak apart of in rood staan voor de decimalen in m³). Antwoord ALLEEN met de cijfers en het scheidingsteken dat je ziet, zonder eenheid en zonder uitleg. Als de foto onscherp, te donker, onder een hoek genomen is, of het display niet duidelijk leesbaar is, antwoord dan exact met: ONDUIDELIJK"
};

function parseFotoDataUrl(input) {
  if (typeof input !== 'string') return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

exports.handler = async function (event) {
  connectBlobs(event);
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = corsHeaders(origin, 'Content-Type, X-Session-Token');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  if (!isAllowedOrigin(origin)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Origin niet toegestaan' }) };
  }
  if (!hasValidSession(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sessie verlopen of ongeldig, log opnieuw in' }) };
  }

  // Fail-closed: kostbare AI-aanroepen mogen niet ongelimiteerd doorgaan als
  // de rate-limit-check zelf hapert (zelfde redenering als bij verify-pin).
  const ip = getClientIp(event);
  const allowed = await checkRateLimitFailClosed('ocr-meter-rate-limit', `ip:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }) };
  }

  if ((event.body || '').length > MAX_BODY_LEN) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Verzoek te groot' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig verzoek' }) };
  }

  const metertype = body.metertype;
  if (!Object.prototype.hasOwnProperty.call(PROMPTS, metertype)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Metertype '${metertype}' wordt nog niet ondersteund` }) };
  }

  if (typeof body.fotoBase64 !== 'string' || body.fotoBase64.length > MAX_FOTO_BASE64_LEN) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Foto ontbreekt of is te groot' }) };
  }
  const foto = parseFotoDataUrl(body.fotoBase64);
  if (!foto) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig fotoformaat' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY ontbreekt');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'OCR-service niet geconfigureerd' }) };
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 50,
      thinking: { type: 'disabled' }, // triviale leestaak, geen redenering nodig
      output_config: { effort: 'low' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: foto.mediaType, data: foto.data } },
          { type: 'text', text: PROMPTS[metertype] }
        ]
      }]
    });

    if (response.stop_reason === 'refusal') {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false }) };
    }

    const tekst = (response.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    // Alleen cijfers/scheidingstekens overhouden - vangt zowel "ONDUIDELIJK" als
    // eventuele afwijkende modeloutput (bv. per ongeluk toegevoegde tekst of tags).
    const waarde = tekst.replace(/[^0-9.,]/g, '');
    if (!waarde) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, waarde }) };
  } catch (err) {
    console.error('ocr-meter fout:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Kon meterstand niet automatisch lezen' }) };
  }
};
