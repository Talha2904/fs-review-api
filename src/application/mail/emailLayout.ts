// The app's email look: one branded HTML layout with a plain-text twin, so every email reads well in Outlook,
// Gmail and on a phone, and still makes sense where HTML is off. Table layout and inline styles only, because
// email clients ignore most CSS. Every value passed in is escaped; callers never pass raw HTML.

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface EmailLayoutInput {
  /** Shown in the inbox list after the subject; never shown in the email itself. */
  preheader: string;
  heading: string;
  /** Plain-text paragraphs, escaped; newlines inside one become line breaks. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Smaller paragraphs after the button, such as security notes. */
  notes?: string[];
  /** Small print under the card; defaults to the automatic, don't-reply line. */
  footer?: string;
}

const NO_REPLY = 'Sent automatically by FS Review. Please don’t reply to this email; replies aren’t read.';
const INK = '#1C1C1C';
const MUTED = '#5B5B5B';
const FONT = "font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const para = (s: string, size: number, color: string, margin: string) =>
  `<p style="margin:${margin};${FONT}font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color};">${escapeHtml(s).replace(/\n/g, '<br>')}</p>`;

export function emailLayout(m: EmailLayoutInput): string {
  const button = m.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td bgcolor="${INK}" style="border-radius:8px;">
        <a href="${escapeHtml(m.button.url)}" target="_blank" style="display:inline-block;padding:12px 24px;${FONT}font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(m.button.label)}</a>
      </td></tr></table>
      ${para('If the button doesn’t work, copy this link into your browser:', 13, MUTED, '0 0 4px')}
      <p style="margin:0 0 24px;${FONT}font-size:13px;line-height:20px;word-break:break-all;"><a href="${escapeHtml(m.button.url)}" target="_blank" style="color:${INK};">${escapeHtml(m.button.url)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(m.heading)}</title></head>
<body style="margin:0;padding:0;background:#F3F6FA;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(m.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F6FA;"><tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 16px;${FONT}font-size:16px;font-weight:600;color:${INK};">FS Review<span style="font-weight:400;color:${MUTED};"> · Financial Statement Review</span></td></tr>
    <tr><td style="background:#ffffff;border-radius:16px;padding:32px 28px;border:1px solid #E4E7EC;">
      <h1 style="margin:0 0 16px;${FONT}font-size:22px;line-height:30px;font-weight:600;color:${INK};">${escapeHtml(m.heading)}</h1>
      ${m.paragraphs.map((p) => para(p, 15, INK, '0 0 16px')).join('\n      ')}
      ${button}
      ${(m.notes || []).map((p) => para(p, 13, MUTED, '0 0 8px')).join('\n      ')}
    </td></tr>
    <tr><td style="padding:16px 4px 0;${FONT}font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(m.footer ?? NO_REPLY)}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** The plain-text twin of a layout, for clients that don't show HTML. */
export function emailText(m: EmailLayoutInput): string {
  return [
    m.heading,
    '',
    ...m.paragraphs.flatMap((p) => [p, '']),
    ...(m.button ? [`${m.button.label}: ${m.button.url}`, ''] : []),
    ...(m.notes || []).flatMap((p) => [p, '']),
    '—',
    m.footer ?? NO_REPLY
  ].join('\n');
}

/** "16:30 (UK time)", the firm's clock, whatever the server's time zone. */
const ukTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso)) + ' (UK time)';

export function passwordResetEmail(p: { name: string; username: string; link: string; expiresAt: string; minutes: number }): EmailContent {
  const first = p.name.trim().split(/\s+/)[0] || p.name;
  const m: EmailLayoutInput = {
    preheader: `Choose a new password for ${p.username}. The link expires at ${ukTime(p.expiresAt)}.`,
    heading: 'Reset your password',
    paragraphs: [
      `Hello ${first},`,
      `Someone asked to reset the password for your FS Review account, ${p.username}. Choose a new password with the button below.`
    ],
    button: { label: 'Choose a new password', url: p.link },
    notes: [
      `The link works once and expires at ${ukTime(p.expiresAt)}, ${p.minutes} minutes after it was requested.`,
      'If you didn’t ask for this, ignore this email. Your password hasn’t changed, and nobody can change it without this link.'
    ]
  };
  return { subject: 'Reset your FS Review password', text: emailText(m), html: emailLayout(m) };
}

/** An invoice email: Finance's own message, in the firm's layout, with the PDF attached by the caller. */
export function invoiceEmail(p: { subject: string; message: string; number: string; firmName: string }): EmailContent {
  const m: EmailLayoutInput = {
    preheader: `Invoice ${p.number}${p.firmName ? ` from ${p.firmName}` : ''}. The PDF is attached.`,
    heading: `Invoice ${p.number}`,
    paragraphs: p.message
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    notes: ['The invoice is attached to this email as a PDF.'],
    footer: p.firmName ? `Sent by ${p.firmName} through FS Review.` : 'Sent through FS Review.'
  };
  return { subject: p.subject, text: p.message, html: emailLayout(m) };
}
