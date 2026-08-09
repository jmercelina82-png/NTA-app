const nodemailer = require('nodemailer');
const { getStore } = require('@netlify/blobs');

// ============ CONFIG ============
// ALLOWED_ORIGINS: comma-gescheiden lijst met domeinen die deze functie mogen aanroepen.
// Instellen in Netlify: Site settings -> Environment variables -> ALLOWED_ORIGINS
// bv: https://jouw-app.netlify.app,https://jouwdomein.nl
// Zonder deze variabele wordt alleen localhost toegestaan (veilige default voor lokaal testen).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:8888,http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const MAX_SUBJECT_LEN = 200;
const MAX_MESSAGE_LEN = 5000;
const MAX_FILENAME_LEN = 150;
const MAX_PDF_BASE64_LEN = 7_000_000; // ~5MB binair, ruim boven de 4.5MB check in de app zelf

const RATE_LIMIT_MAX = 5;           // max aantal verzoeken...
const RATE_LIMIT_WINDOW_MS = 3600000; // ...per uur per IP

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function getClientIp(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

async function checkRateLimit(ip) {
  // Best-effort rate limiting via Netlify Blobs. Als de store om wat voor reden dan
  // ook niet beschikbaar is, faalt de functie niet dicht (geen mail blokkeren door
  // een opslagfout) maar loggen we het wel.
  try {
    const store = getStore('send-email-rate-limit');
    const key = `ip:${ip}`;
    const now = Date.now();
    const raw = await store.get(key, { type: 'json' });
    const hits = Array.isArray(raw) ? raw.filter(t => now - t < RATE_LIMIT_WINDOW_MS) : [];

    if (hits.length >= RATE_LIMIT_MAX) {
      return false;
    }

    hits.push(now);
    await store.setJSON(key, hits);
    return true;
  } catch (err) {
    console.warn('Rate limit check overgeslagen (blobs store niet beschikbaar):', err.message);
    return true;
  }
}

exports.handler = async function(event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Alleen toegestane origins mogen daadwerkelijk mailen. Preflight (OPTIONS) hierboven
  // zorgt er in de browser al voor dat dit punt bij een verkeerde origin niet bereikt
  // wordt, maar we controleren het hier ook expliciet als extra laag.
  if (!ALLOWED_ORIGINS.includes(origin)) {
    console.warn('Geweigerd verzoek van niet-toegestane origin:', origin || '(leeg)');
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Origin niet toegestaan' }) };
  }

  const ip = getClientIp(event);
  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Te veel verzoeken. Probeer het over een uur opnieuw.' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { subject, message, pdfBase64, filename } = data;

    if (subject && subject.length > MAX_SUBJECT_LEN) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Onderwerp te lang (max ${MAX_SUBJECT_LEN} tekens)` }) };
    }
    if (message && message.length > MAX_MESSAGE_LEN) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Bericht te lang (max ${MAX_MESSAGE_LEN} tekens)` }) };
    }
    if (filename && filename.length > MAX_FILENAME_LEN) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Bestandsnaam te lang (max ${MAX_FILENAME_LEN} tekens)` }) };
    }
    if (pdfBase64 && pdfBase64.length > MAX_PDF_BASE64_LEN) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bijlage te groot' }) };
    }
    // Veilige bestandsnaam: alleen bekende PDF-bijlagen toestaan, geen pad-tekens.
    const safeFilename = filename ? filename.replace(/[^a-zA-Z0-9._-]/g, '_') : 'FSB_rapport.pdf';

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_PASS;

    if (!user || !pass) {
      throw new Error('Stel GMAIL_USER en GMAIL_PASS in als omgevingsvariabelen op Netlify (Site settings → Environment variables)');
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass }
    });

    const mailOptions = {
      from: 'FSB Onderhoudsbedrijf <' + user + '>',
      to: 'Staedion.mutatie@rendon.nl',
      cc: user,
      subject: subject || 'FSB NTA 8025 Rapport',
      text: message || '',
      attachments: []
    };

    if (pdfBase64) {
      mailOptions.attachments.push({
        filename: safeFilename,
        content: pdfBase64,
        encoding: 'base64',
        contentType: 'application/pdf'
      });
    }

    await transporter.sendMail(mailOptions);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('Email fout:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
