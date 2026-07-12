const nodemailer = require('nodemailer');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const { subject, message, pdfBase64, filename } = data;
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
        filename: filename || 'FSB_rapport.pdf',
        content: pdfBase64,
        encoding: 'base64',
        contentType: 'application/pdf'
      });
    }

    await transporter.sendMail(mailOptions);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('Email fout:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
