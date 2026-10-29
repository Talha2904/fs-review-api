import type { User } from '../../domain/identity/User.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  /** Username or email, both already lower-cased by the caller. */
  findByLogin(login: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  list(): Promise<User[]>;
  count(): Promise<number>;
  create(user: User): Promise<void>;
  /** Creates the user only when there are no users at all, atomically; false when someone was first. */
  createFirst(user: User): Promise<boolean>;
  update(user: User): Promise<void>;
}
