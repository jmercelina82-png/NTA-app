// Lokale test voor de SMTP functie
// Zet GMAIL_USER en GMAIL_PASS als omgevingsvariabelen voordat je dit script draait,
// bv.: GMAIL_USER=... GMAIL_PASS=... node test-smtp.js
if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
  console.error('Ontbrekende env vars: stel GMAIL_USER en GMAIL_PASS in voordat je dit script draait.');
  process.exit(1);
}

const { handler } = require('./netlify/functions/send-email.js');

const event = {
  httpMethod: 'POST',
  body: JSON.stringify({
    subject: 'TEST FSB NTA 8025 - SMTP check',
    message: 'Dit is een testbericht vanuit de FSB app.\n\nSMTP zonder nodemailer - werkt dit?',
    pdfBase64: null,
    filename: null
  })
};

console.log('Versturen via Gmail SMTP...');
handler(event).then(res => {
  console.log('Status:', res.statusCode);
  console.log('Body:', res.body);
}).catch(err => {
  console.error('Fout:', err.message);
});
