import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

/**
 * Shared-access-code check (PRD §6.3).
 * This is a low-complexity shared gate, NOT strong authentication.
 * CORS restrictions complement it but never replace it.
 */
export function requireAccessCode(expectedCode: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.header('x-access-code') ?? '';
    const a = Buffer.from(provided);
    const b = Buffer.from(expectedCode);
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match) {
      res.status(401).json({ error: 'invalid_access_code' });
      return;
    }
    next();
  };
}
