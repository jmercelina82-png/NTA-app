const nodemailer = require('nodemailer');
const {
  corsHeaders,
  isAllowedOrigin,
  getClientIp,
  checkRateLimit,
  hasValidSession,
  connectBlobs
} = require('./lib/_shared');
const { getInspectieStore, isValidId, inspectieKey } = require('./lib/inspecties');

// ============ CONFIG ============
const MAX_SUBJECT_LEN = 200;
const MAX_MESSAGE_LEN = 5000;
const MAX_FILENAME_LEN = 150;
const MAX_PDF_BASE64_LEN = 7_000_000; // ~5MB binair, ruim boven de 4.5MB check in de app zelf

const RATE_LIMIT_MAX = 5;           // max aantal verzoeken...
const RATE_LIMIT_WINDOW_MS = 3600000; // ...per uur per IP

exports.handler = async function(event) {
  connectBlobs(event);
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = corsHeaders(origin, 'Content-Type, X-Session-Token');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Alleen toegestane origins mogen daadwerkelijk mailen. Preflight (OPTIONS) hierboven
  // zorgt er in de browser al voor dat dit punt bij een verkeerde origin niet bereikt
  // wordt, maar we controleren het hier ook expliciet als extra laag.
  if (!isAllowedOrigin(origin)) {
    console.warn('Geweigerd verzoek van niet-toegestane origin:', origin || '(leeg)');
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Origin niet toegestaan' }) };
  }

  // Vereist een geldig sessietoken van verify-pin.js. Zonder dit kan de mailfunctie
  // rechtstreeks aangeroepen worden zelfs als de client-side PIN-check omzeild is.
  if (!hasValidSession(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sessie verlopen of ongeldig, log opnieuw in' }) };
  }

  const ip = getClientIp(event);
  const allowed = await checkRateLimit('send-email-rate-limit', `ip:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Te veel verzoeken. Probeer het over een uur opnieuw.' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { subject, message, pdfBase64, filename, id } = data;

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

    // Best effort: koppel het verzonden rapport aan de inspectie, zet 'm op
    // afgerond en werk de verzonden-datum bij - ook bij een herhaalde
    // verzending (opnieuw versturen vanuit het archief), zodat die altijd de
    // laatste keer verzenden weergeeft. Een fout hier mag de succesvolle
    // verzending niet ongedaan maken.
    if (isValidId(id)) {
      try {
        const store = getInspectieStore();
        const key = inspectieKey(id);
        const rec = await store.get(key, { type: 'json' });
        if (rec) {
          rec.status = 'afgerond';
          rec.verzonden = Date.now();
          rec.laatstGewijzigd = Date.now();
          await store.setJSON(key, rec);
        }
      } catch (statusErr) {
        console.warn('Kon inspectie niet op afgerond zetten:', statusErr.message);
      }
    }

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
