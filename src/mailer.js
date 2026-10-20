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
  // Code first in the subject and alone on its own line: Gmail and phones then offer a
  // one-tap "Copy code" button, and tapping the code in the email selects all of it.
  const subject = `${code} is your AI Viva sign-in code`;
  const text = `Your AI Viva sign-in code:\n\n${code}\n\nCopy it and paste it on the sign-in page. It expires in 10 minutes.\nIf you didn't ask for it, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#2b1d14;max-width:440px;margin:0 auto;padding:24px">
    <p style="margin:0 0 6px;font-size:15px">Your AI Viva sign-in code</p>
    <div style="margin:12px 0 16px;padding:16px;border:1px solid #ece2d7;border-radius:12px;background:#fbf7f2;text-align:center">
      <span style="font:700 34px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:8px;color:#5c3a21;-webkit-user-select:all;user-select:all">${code}</span>
    </div>
    <p style="margin:0 0 8px;font-size:14px">Tap or double-click the code to select it, copy it, and paste it on the sign-in page.</p>
    <p style="margin:0;font-size:13px;color:#7a6656">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`;
  if (EMAIL_MODE === 'console') {
    outbox.push({ to: email, code, at: Date.now() });
    if (outbox.length > 100) outbox.shift();
    console.log(`[email:console] Sign-in code for ${email}: ${code}  (set SMTP_HOST to send real email)`);
    return;
  }
  await getTransport().sendMail({ from: smtp.from, to: email, subject, text, html });
}
