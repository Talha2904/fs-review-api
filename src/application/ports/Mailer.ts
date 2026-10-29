export interface MailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface MailMessage {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

/** Outgoing email. Null-configured adapters report `configured: false` and refuse to send. */
export interface Mailer {
  readonly configured: boolean;
  readonly from: string;
  send(message: MailMessage): Promise<void>;
}
