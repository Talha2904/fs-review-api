import { describe, expect, it } from 'vitest';

import { escapeHtml, invoiceEmail, passwordResetEmail } from '../../src/application/mail/emailLayout.js';

const reset = (name = 'Talha Bin Sajjad') =>
  passwordResetEmail({
    name,
    username: 'talha.test',
    link: 'https://fs.example.com/?reset=abc123',
    expiresAt: '2026-11-03T16:30:00.000Z',
    minutes: 30
  });

describe('email layout', () => {
  it('escapes everything it is given', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const m = reset('<script>alert(1)</script>');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('sends the reset link as a button and as plain text, with the expiry in UK time', () => {
    const m = reset();
    expect(m.subject).toBe('Reset your StatementX password');
    expect(m.html).toContain('href="https://fs.example.com/?reset=abc123"');
    expect(m.html).toContain('Hello Talha,');
    expect(m.text).toContain('https://fs.example.com/?reset=abc123');
    expect(m.text).toContain('Hello Talha,');
    // 16:30 UTC on 3 November is 16:30 in London (GMT)
    expect(m.text).toContain('16:30 (UK time)');
    expect(m.text).toContain('talha.test');
  });

  it('keeps Finance’s invoice message, in paragraphs, without the do-not-reply footer', () => {
    const m = invoiceEmail({
      subject: 'Invoice INV-1',
      message: 'Dear client,\n\nPlease find the invoice attached.',
      number: 'INV-1',
      firmName: 'PA Ltd'
    });
    expect(m.text).toBe('Dear client,\n\nPlease find the invoice attached.');
    expect(m.html).toContain('>Dear client,</p>');
    expect(m.html).toContain('Sent by PA Ltd through StatementX.');
    expect(m.html).not.toContain('don’t reply');
  });

  it('shows the Project Accountants mark from a public https app address, beside the StatementX wordmark in text', () => {
    const withLogo = passwordResetEmail({
      name: 'Talha',
      username: 't',
      link: 'https://fs.example.com/?reset=abc',
      expiresAt: '2026-11-03T16:30:00.000Z',
      minutes: 30,
      appUrl: 'https://fs.example.com/'
    });
    expect(withLogo.html).toContain('<img src="https://fs.example.com/pa-mark.png"');
    expect(withLogo.html).toContain('alt="Project Accountants"');
    expect(withLogo.html).toContain('Statement<span style="color:#4fbfb0;font-weight:600;">X</span>');
    expect(withLogo.html).toContain('By Project Accountants');
    const noLogo = reset();
    expect(noLogo.html).not.toContain('<img');
    expect(noLogo.html).toContain('Statement<span style="color:#4fbfb0;font-weight:600;">X</span>');
    // a mail app cannot load an image from localhost or plain http: no broken image
    for (const appUrl of ['http://fs.example.com', 'https://localhost:5173'])
      expect(invoiceEmail({ subject: 's', message: 'm', number: 'INV-1', firmName: '', appUrl }).html).not.toContain('<img');
    expect(invoiceEmail({ subject: 's', message: 'm', number: 'INV-1', firmName: '', appUrl: 'https://fs.example.com' }).html).toContain(
      'https://fs.example.com/pa-mark.png'
    );
  });
});
