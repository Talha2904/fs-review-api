import nodemailer, { type Transporter } from 'nodemailer';

import type { MailMessage, Mailer } from '../../application/ports/Mailer.js';

export interface SmtpConfig {
  host?: string | undefined;
  port: number;
  user?: string | undefined;
  pass?: string | undefined;
  secure: boolean;
  from?: string | undefined;
}

/**
 * SMTP through nodemailer. host "test" uses an in-memory transport and keeps the last message,
 * which the tests and the UAT mail checks read back.
 */
export class NodemailerMailer implements Mailer {
  readonly configured: boolean;
  readonly from: string;
  private readonly transport: Transporter | null;
  lastMessage: string | null = null;

  constructor(cfg: SmtpConfig) {
    const test = cfg.host === 'test';
    this.configured = test || (!!cfg.host && !!cfg.from);
    this.from = cfg.from || (test ? 'test@example.com' : '');
    this.transport = !this.configured
      ? null
      : test
        ? nodemailer.createTransport({ streamTransport: true, buffer: true })
        : nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined
          });
  }

  async send(m: MailMessage): Promise<void> {
    if (!this.transport) throw new Error('Email isn’t set up on the server.');
    const info = await this.transport.sendMail({
      from: this.from,
      to: m.to,
      cc: m.cc,
      subject: m.subject,
      text: m.text,
      attachments: m.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType }))
    });
    if (info && typeof (info as { message?: unknown }).message !== 'undefined')
      this.lastMessage = String((info as { message: Buffer | string }).message);
  }
}
