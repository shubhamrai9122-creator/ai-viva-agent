// Outgoing email. With SMTP settings (SMTP_HOST etc.) codes are emailed; without them the
// server runs in console mode: the code is printed in the server log so a local demo still works.
import nodemailer from 'nodemailer';

const smtp = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER,
};
export const EMAIL_MODE = smtp.host ? 'smtp' : 'console';

let transport = null;
const getTransport = () => transport ||= nodemailer.createTransport({
  host: smtp.host, port: smtp.port, secure: smtp.secure,
  auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
});

// Last messages sent in console mode (tests read these; nothing else does).
export const outbox = [];

export async function sendLoginCode(email, code) {
  const subject = `${code} is your AI Viva sign-in code`;
  const text = `Your AI Viva sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;color:#2b1d14">
    <p>Your AI Viva sign-in code is</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#6b4226">${code}</p>
    <p style="color:#7a6656">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`;
  if (EMAIL_MODE === 'console') {
    outbox.push({ to: email, code, at: Date.now() });
    if (outbox.length > 100) outbox.shift();
    console.log(`[email:console] Sign-in code for ${email}: ${code}  (set SMTP_HOST to send real email)`);
    return;
  }
  await getTransport().sendMail({ from: smtp.from, to: email, subject, text, html });
}
