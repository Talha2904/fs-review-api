import type { Mailer } from '../ports/Mailer.js';
import type { UserRepository } from '../ports/UserRepository.js';

export interface AuthStatus {
  setupRequired: boolean;
  resetAvailable: boolean;
}

/** What the sign-in page needs before anyone is signed in. */
export class GetAuthStatus {
  constructor(
    private readonly users: UserRepository,
    private readonly mailer: Mailer,
    private readonly appUrl: string
  ) {}

  async execute(): Promise<AuthStatus> {
    return { setupRequired: (await this.users.count()) === 0, resetAvailable: this.mailer.configured && !!this.appUrl };
  }
}
