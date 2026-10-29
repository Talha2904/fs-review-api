export interface PasswordHash {
  hash: string;
  salt: string;
}

export interface PasswordHasher {
  hash(password: string): Promise<PasswordHash>;
  verify(password: string, stored: PasswordHash): Promise<boolean>;
}
