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
  /** The web app's address (APP_URL): the header shows the Project Accountants mark from it (public https only). */
  appUrl?: string;
}

// The product name in every email.
const PRODUCT = 'StatementX';
const NO_REPLY = `Sent automatically by ${PRODUCT}. Please don’t reply to this email; replies aren’t read.`;
// The DiligenceX email look, shared across Project Accountants apps: a navy header band (the sign-in panel's navy),
// a white card, a pill button and Poppins, with system fonts where an email app cannot load it.
const NAVY = '#0b1a37';
const INK = '#14213d';
const TEXT = '#262719';
const MUTED = '#5b6573';
const LINK = '#3e7cc4';
const PAGE = '#f2f5f9';
const LINE = '#e3e8ef';
// The X of the StatementX wordmark: one colour from its gradient, readable on the navy band (email apps cannot draw
// the app's animated strokes or clip gradients to text)
const X_MARK = '#4fbfb0';
const FONT = "font-family:Poppins,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

/**
 * The header on the navy band: the Project Accountants mark from the app (public/pa-mark.png; only from a public https
 * address, as an email app cannot load an image from localhost or plain http, and a broken image looks worse than
 * none), then the StatementX wordmark in text and "By Project Accountants".
 */
function header(appUrl?: string): string {
  let logo = '';
  try {
    const u = new URL(appUrl || '');
    if (u.protocol === 'https:' && !/^(localhost|127\.|\[::1\])/.test(u.hostname)) logo = u.origin + '/pa-mark.png';
  } catch {
    logo = '';
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        ${logo ? `<td style="padding-right:12px;vertical-align:middle;"><img src="${escapeHtml(logo)}" width="34" height="34" alt="Project Accountants" style="display:block;border:0;border-radius:8px;"></td>` : ''}
        <td style="vertical-align:middle;${FONT}">
          <div style="font-size:22px;line-height:26px;font-weight:500;letter-spacing:-0.6px;color:#ffffff;">Statement<span style="color:${X_MARK};font-weight:600;">X</span></div>
          <div style="font-size:12px;line-height:18px;color:#cfd6e2;">By Project Accountants</div>
        </td></tr></table>`;
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const para = (s: string, size: number, color: string, margin: string) =>
  `<p style="margin:${margin};${FONT}font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color};">${escapeHtml(s).replace(/\n/g, '<br>')}</p>`;

/** A full-width row of the card (tables and inline styles only: Gmail and Outlook drop most CSS). */
const row = (inner: string, pad = '0 32px') => `<tr><td style="padding:${pad};">${inner}</td></tr>`;

export function emailLayout(m: EmailLayoutInput): string {
  // the padding sits on the cell, so the button keeps its shape where a client ignores padding on links
  const button = m.button
    ? row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="${INK}" style="border-radius:999px;padding:14px 30px;">
          <a href="${escapeHtml(m.button.url)}" target="_blank" style="${FONT}font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;display:inline-block;">${escapeHtml(m.button.label)}</a>
        </td></tr></table>
      ${para('If the button doesn’t work, copy this link into your browser:', 12, MUTED, '18px 0 2px')}
      <p style="margin:0;${FONT}font-size:12px;line-height:19px;word-break:break-all;"><a href="${escapeHtml(m.button.url)}" target="_blank" style="color:${LINK};text-decoration:underline;">${escapeHtml(m.button.url)}</a></p>`,
        '4px 32px 24px'
      )
    : '';
  const notes = (m.notes || []).length
    ? row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${LINE};padding-top:18px;">
        ${(m.notes || []).map((p) => para(p, 13, MUTED, '0 0 8px')).join('\n        ')}
      </td></tr></table>`,
        '0 32px 22px'
      )
    : '';
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(m.heading)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(m.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background:${PAGE};"><tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
    <tr><td bgcolor="${NAVY}" style="background:${NAVY};border-radius:16px 16px 0 0;padding:22px 32px;">
      ${header(m.appUrl)}
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${LINE};border-top:0;border-radius:0 0 16px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${row(
          `<h1 style="margin:0 0 16px;${FONT}font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.2px;color:${INK};">${escapeHtml(m.heading)}</h1>
          ${m.paragraphs.map((p) => para(p, 15, TEXT, '0 0 14px')).join('\n          ')}`,
          '30px 32px 8px'
        )}
        ${button}
        ${notes}
      </table>
    </td></tr>
    <tr><td align="center" style="padding:18px 16px 0;${FONT}font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(m.footer ?? NO_REPLY)}<br>&copy; Project Accountants Ltd</td></tr>
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

export function passwordResetEmail(p: {
  name: string;
  username: string;
  link: string;
  expiresAt: string;
  minutes: number;
  appUrl?: string;
}): EmailContent {
  const first = p.name.trim().split(/\s+/)[0] || p.name;
  const m: EmailLayoutInput = {
    preheader: `Choose a new password for ${p.username}. The link expires at ${ukTime(p.expiresAt)}.`,
    heading: 'Reset your password',
    paragraphs: [
      `Hello ${first},`,
      `Someone asked to reset the password for your StatementX account, ${p.username}. Choose a new password with the button below.`
    ],
    button: { label: 'Choose a new password', url: p.link },
    notes: [
      `The link works once and expires at ${ukTime(p.expiresAt)}, ${p.minutes} minutes after it was requested.`,
      'If you didn’t ask for this, ignore this email. Your password hasn’t changed, and nobody can change it without this link.'
    ],
    ...(p.appUrl ? { appUrl: p.appUrl } : {})
  };
  return { subject: 'Reset your StatementX password', text: emailText(m), html: emailLayout(m) };
}

/** An invoice email: Finance's own message, in the firm's layout, with the PDF attached by the caller. */
export function invoiceEmail(p: { subject: string; message: string; number: string; firmName: string; appUrl?: string }): EmailContent {
  const m: EmailLayoutInput = {
    preheader: `Invoice ${p.number}${p.firmName ? ` from ${p.firmName}` : ''}. The PDF is attached.`,
    heading: `Invoice ${p.number}`,
    paragraphs: p.message
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    notes: ['The invoice is attached to this email as a PDF.'],
    footer: p.firmName ? `Sent by ${p.firmName} through StatementX.` : 'Sent through StatementX.',
    ...(p.appUrl ? { appUrl: p.appUrl } : {})
  };
  return { subject: p.subject, text: p.message, html: emailLayout(m) };
}
