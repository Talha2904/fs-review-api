/** Random secrets for sessions and reset links, and the one-way fingerprint stored for them. */
export interface Tokens {
  /** A new random secret, hex, 32 bytes of entropy. */
  secret(): string;
  /** SHA-256 hex fingerprint of a secret. Only fingerprints are stored. */
  fingerprint(secret: string): string;
  /** SHA-256 hex of file contents: a document's identity. */
  fingerprintBytes(bytes: Uint8Array): string;
}
