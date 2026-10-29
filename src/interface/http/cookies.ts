import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'fsr_session';
const MAX_AGE_SECONDS = 12 * 3600;

export function readSessionCookie(req: Request): string | undefined {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(v.join('='));
    } catch {
      return undefined; // a malformed cookie is no session, not a server error
    }
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`
  );
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}
