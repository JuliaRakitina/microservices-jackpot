import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { DomainError, parse } from '../../../packages/contracts/src/errors.js';
import {
  eventPayloadSchemas,
  type DomainEvent,
} from '../../../packages/contracts/src/events.js';
import type {
  Database,
  Transaction,
} from '../../../packages/runtime/src/database.js';

export const TOKEN_ISSUER = 'jackpot-auth';
export const TOKEN_AUDIENCE = 'jackpot-api';
export const TOKEN_LIFETIME_SECONDS = 15 * 60;

const email = z.string().trim().toLowerCase().email().max(254);
export const registrationSchema = z
  .object({ email, password: z.string().min(12).max(128) })
  .strict();
export const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
const verificationSchema = z
  .object({ token: z.string().min(1).max(8192) })
  .strict();
const principalSchema = z.object({ sub: z.string().uuid() }).passthrough();

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function checkPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const match = /^scrypt\$32768\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(
    encoded,
  );
  // Do comparable work for unknown users and malformed stored hashes.
  const salt = match?.[1] ? Buffer.from(match[1], 'hex') : Buffer.alloc(16);
  const actual = await derive(password, salt);
  const expected = match?.[2] ? Buffer.from(match[2], 'hex') : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && match !== null;
}

type IdentityRow = Record<string, unknown> & {
  id: string;
  state: 'pending' | 'active';
  password_hash: string;
};

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly jwtSecret: string,
  ) {
    if (Buffer.byteLength(jwtSecret) < 32)
      throw new Error('JWT secret must contain at least 32 bytes');
  }

  async register(input: unknown, correlationId: string) {
    const request = parse(registrationSchema, input);
    const passwordHash = await hashPassword(request.password);
    const id = randomUUID();
    return this.db.transaction(async (tx) => {
      const inserted = await tx.query<IdentityRow>(
        `INSERT INTO auth_identities (id, email, password_hash)
         VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, state`,
        [id, request.email, passwordHash],
      );
      const identity = inserted[0];
      if (!identity)
        throw new DomainError('ALREADY_EXISTS', 'Email is already registered');
      // Publication is committed with the pending credential. Outbox retries and
      // inbox deduplication complete registration after a broker/service outage.
      await tx.emit(
        'identity.registered',
        { id: identity.id, email: request.email },
        correlationId,
      );
      return { id: identity.id, state: identity.state };
    });
  }

  async login(input: unknown, _correlationId?: string) {
    const request = parse(loginSchema, input);
    const [identity] = await this.db.query<IdentityRow>(
      'SELECT id, password_hash, state FROM auth_identities WHERE email = $1',
      [request.email],
    );
    const validPassword = await checkPassword(
      request.password,
      identity?.password_hash ?? '',
    );
    if (!identity || !validPassword) {
      throw new DomainError('UNAUTHENTICATED', 'Invalid email or password');
    }
    if (identity.state !== 'active') {
      throw new DomainError(
        'FAILED_PRECONDITION',
        'Profile creation is pending; retry login shortly',
      );
    }
    const accessToken = jwt.sign({}, this.jwtSecret, {
      algorithm: 'HS256',
      subject: identity.id,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: TOKEN_LIFETIME_SECONDS,
    });
    return { accessToken, expiresIn: TOKEN_LIFETIME_SECONDS };
  }

  async verify(input: unknown, _correlationId?: string) {
    const { token } = parse(verificationSchema, input);
    let id: string;
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        maxAge: TOKEN_LIFETIME_SECONDS,
      });
      id = principalSchema.parse(payload).sub;
      if (typeof payload === 'string' || typeof payload.exp !== 'number')
        throw new Error('Missing expiry');
    } catch {
      throw new DomainError(
        'UNAUTHENTICATED',
        'Invalid or expired access token',
      );
    }
    const [identity] = await this.db.query<IdentityRow>(
      'SELECT id, state FROM auth_identities WHERE id = $1',
      [id],
    );
    if (!identity || identity.state !== 'active') {
      throw new DomainError('UNAUTHENTICATED', 'Identity is not active');
    }
    return { id };
  }

  async handle(event: DomainEvent, tx: Transaction): Promise<void> {
    if (event.type !== 'profile.created') return;
    const payload = parse(
      eventPayloadSchemas['profile.created'],
      event.payload,
    );
    const updated = await tx.query(
      `WITH activated AS (
         UPDATE auth_identities SET state = 'active', activated_at = COALESCE(activated_at, NOW())
         WHERE id = $1 RETURNING id
       ) SELECT id FROM activated`,
      [payload.id],
    );
    if (updated.length === 0) {
      throw new DomainError(
        'FAILED_PRECONDITION',
        'Profile has no corresponding identity',
      );
    }
  }
}
