// Starting accounts, created once by `npm run seed` on the api. They share a known password:
// change each one after first sign-in.
import type { Role } from './roles.js';

export interface SeedUser {
  name: string;
  username: string;
  role: Role;
  password: string;
}

export const SEED_USERS: readonly SeedUser[] = [
  { name: 'Hamza Mehmood', username: 'hamza.mehmood', role: 'Administrator', password: '12345678' },
  { name: 'Muhammad Salman', username: 'muhammad.salman', role: 'Preparer', password: '12345678' },
  { name: 'Rahat Kalim', username: 'rahat.kalim', role: 'Reviewer', password: '12345678' },
  { name: 'Ali Awan', username: 'ali.awan', role: 'Manager', password: '12345678' },
  { name: 'Ibrahim Moola', username: 'ibrahim.moola', role: 'Finance', password: '12345678' }
];
