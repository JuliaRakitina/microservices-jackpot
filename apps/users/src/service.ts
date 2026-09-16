import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, parse } from '../../../packages/contracts/src/errors.js';
import type {
  DomainEvent,
  EventType,
} from '../../../packages/contracts/src/events.js';
import { MAX_POINTS, points } from '../../../packages/contracts/src/points.js';
import type {
  Database,
  Transaction,
} from '../../../packages/runtime/src/database.js';

export const subscriptions: EventType[] = [
  'identity.registered',
  'bet.requested',
  'bet.settled',
];
const id = z.string().uuid();
const amount = z.string();
const identitySchema = z
  .object({ id, email: z.string().email().max(254) })
  .strict();
const requestedSchema = z
  .object({ betId: id, userId: id, amount, key: z.string().min(8).max(128) })
  .strict();
const settledSchema = z
  .object({ betId: id, userId: id, won: z.boolean(), payout: amount })
  .strict();
const creditSchema = z
  .object({ id, amount, key: z.string().min(8).max(128) })
  .strict();
const userSchema = z.object({ id }).strict();
const ledgerSchema = z
  .object({
    id,
    cursor: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,18})$/)
      .refine((value) => value.length < 19 || value <= MAX_POINTS.toString())
      .optional(),
  })
  .strict();

interface ProfileRow extends Record<string, unknown> {
  id: string;
  email: string;
  role: 'user' | 'admin';
  balance: string;
}
interface ReservationRow extends Record<string, unknown> {
  bet_id: string;
  user_id: string;
  amount: string;
  key: string;
  state: 'pending' | 'reserved' | 'rejected';
  reason: string | null;
}
interface ReceiptRow extends Record<string, unknown> {
  user_id: string;
  won: boolean;
  payout: string;
}

export function checkedBalance(balance: bigint, delta: bigint): bigint {
  const result = balance + delta;
  if (result < 0n || result > MAX_POINTS) {
    throw new DomainError(
      'FAILED_PRECONDITION',
      'Balance would exceed its permitted range',
    );
  }
  return result;
}

export function validateSettlement(won: boolean, payout: unknown): bigint {
  const value = points(payout, true);
  if (!won && value !== 0n) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'A losing settlement cannot create a payout',
    );
  }
  return value;
}

export class UsersService {
  constructor(private readonly db: Database) {}

  async getUser(request: unknown, _correlationId = '') {
    const input = parse(userSchema, request);
    const [profile] = await this.db.query<ProfileRow>(
      'SELECT id, email, role, balance FROM profiles WHERE id = $1',
      [input.id],
    );
    if (!profile) throw new DomainError('NOT_FOUND', 'User not found');
    return profile;
  }

  async getLedger(request: unknown, _correlationId = '') {
    const input = parse(ledgerSchema, request);
    await this.getUser({ id: input.id });
    const rows = await this.db.query<{
      id: string;
      sequence: string;
      delta: string;
      balance: string;
      reference: string;
      createdAt: string;
    }>(
      `SELECT id, sequence::text AS sequence, delta, balance, reference, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
        FROM ledger WHERE user_id = $1 AND sequence > $2::bigint ORDER BY ledger.sequence LIMIT 101`,
      [input.id, input.cursor ?? '0'],
    );
    const page = rows.slice(0, 100);
    return {
      entries: page.map(({ sequence: _sequence, ...entry }) => entry),
      nextCursor: rows.length > 100 ? page.at(-1)!.sequence : '',
    };
  }

  async credit(request: unknown, _correlationId = '') {
    const input = parse(creditSchema, request);
    const value = points(input.amount);
    return this.db.transaction(async (tx) => {
      const profile = await this.lockProfile(tx, input.id);
      if (!profile) throw new DomainError('NOT_FOUND', 'User not found');
      const [previous] = await tx.query<{ amount: string }>(
        'SELECT amount FROM credits WHERE user_id = $1 AND key = $2',
        [input.id, input.key],
      );
      if (previous) {
        if (previous.amount !== value.toString())
          throw new DomainError(
            'ALREADY_EXISTS',
            'Idempotency key was used for another amount',
          );
        return profile;
      }
      const balance = await this.appendLedger(
        tx,
        profile,
        value,
        `credit:${input.id}:${input.key}`,
      );
      await tx.query(
        'INSERT INTO credits(user_id, key, amount) VALUES ($1, $2, $3)',
        [input.id, input.key, value.toString()],
      );
      return { ...profile, balance };
    });
  }

  async handle(event: DomainEvent, tx: Transaction): Promise<void> {
    switch (event.type) {
      case 'identity.registered': {
        const input = parse(identitySchema, event.payload);
        const created = await tx.query(
          'INSERT INTO profiles(id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id',
          [input.id, input.email],
        );
        const [profile] = await tx.query<ProfileRow>(
          'SELECT id, email, role, balance FROM profiles WHERE id = $1 FOR UPDATE',
          [input.id],
        );
        if (!profile || profile.email !== input.email)
          throw new DomainError(
            'ALREADY_EXISTS',
            'Identity already belongs to another profile',
          );
        if (created.length)
          await tx.emit(
            'profile.created',
            { id: input.id },
            event.correlationId,
          );
        return;
      }
      case 'bet.requested':
        await this.reserve(event, tx);
        return;
      case 'bet.settled':
        await this.settle(event, tx);
        return;
      default:
        throw new DomainError('INVALID_ARGUMENT', 'Unsupported Users event');
    }
  }

  private async reserve(event: DomainEvent, tx: Transaction) {
    const input = parse(requestedSchema, event.payload);
    const value = points(input.amount);
    // The business identifier is locked before the account, preventing a second debit
    // even when the same logical command is republished with a different event ID.
    const inserted = await tx.query(
      `INSERT INTO reservations(bet_id, user_id, amount, key, state)
      VALUES ($1, $2, $3, $4, 'pending') ON CONFLICT (bet_id) DO NOTHING RETURNING bet_id`,
      [input.betId, input.userId, value.toString(), input.key],
    );
    const [reservation] = await tx.query<ReservationRow>(
      'SELECT * FROM reservations WHERE bet_id = $1 FOR UPDATE',
      [input.betId],
    );
    if (
      !reservation ||
      reservation.user_id !== input.userId ||
      reservation.amount !== value.toString() ||
      reservation.key !== input.key
    ) {
      throw new DomainError(
        'ALREADY_EXISTS',
        'Bet identifier was used for different funds',
      );
    }
    if (!inserted.length) {
      if (reservation.state === 'pending')
        throw new DomainError(
          'FAILED_PRECONDITION',
          'Reservation is not complete',
        );
      return;
    }
    const profile = await this.lockProfile(tx, input.userId);
    if (!profile || BigInt(profile.balance) < value) {
      const reason = profile ? 'insufficient_points' : 'user_not_found';
      await tx.query(
        "UPDATE reservations SET state = 'rejected', reason = $2 WHERE bet_id = $1",
        [input.betId, reason],
      );
      await tx.emit(
        'funds.rejected',
        { betId: input.betId, userId: input.userId, reason },
        event.correlationId,
      );
      return;
    }
    await this.appendLedger(tx, profile, -value, `debit:${input.betId}`);
    await tx.query(
      "UPDATE reservations SET state = 'reserved' WHERE bet_id = $1",
      [input.betId],
    );
    await tx.emit(
      'funds.reserved',
      { betId: input.betId, userId: input.userId, amount: value.toString() },
      event.correlationId,
    );
  }

  private async settle(event: DomainEvent, tx: Transaction) {
    const input = parse(settledSchema, event.payload);
    const value = validateSettlement(input.won, input.payout);
    const [reservation] = await tx.query<ReservationRow>(
      'SELECT * FROM reservations WHERE bet_id = $1 FOR UPDATE',
      [input.betId],
    );
    if (!reservation || reservation.state !== 'reserved')
      throw new DomainError(
        'FAILED_PRECONDITION',
        'Settlement requires a completed debit',
      );
    if (reservation.user_id !== input.userId)
      throw new DomainError(
        'INVALID_ARGUMENT',
        'Settlement user differs from the debited user',
      );
    const [receipt] = await tx.query<ReceiptRow>(
      'SELECT user_id, won, payout FROM settlement_receipts WHERE bet_id = $1',
      [input.betId],
    );
    if (receipt) {
      if (
        receipt.user_id !== input.userId ||
        receipt.won !== input.won ||
        receipt.payout !== value.toString()
      ) {
        throw new DomainError(
          'ALREADY_EXISTS',
          'Settlement identifier was used for another outcome',
        );
      }
      return;
    }
    const profile = await this.lockProfile(tx, input.userId);
    if (!profile)
      throw new DomainError(
        'FAILED_PRECONDITION',
        'Settlement user is unavailable',
      );
    if (value > 0n)
      await this.appendLedger(tx, profile, value, `payout:${input.betId}`);
    await tx.query(
      'INSERT INTO settlement_receipts(bet_id, user_id, won, payout) VALUES ($1, $2, $3, $4)',
      [input.betId, input.userId, input.won, value.toString()],
    );
    await tx.emit(
      'payout.applied',
      {
        betId: input.betId,
        userId: input.userId,
        won: input.won,
        payout: value.toString(),
      },
      event.correlationId,
    );
  }

  private async lockProfile(tx: Transaction, userId: string) {
    const [profile] = await tx.query<ProfileRow>(
      'SELECT id, email, role, balance FROM profiles WHERE id = $1 FOR UPDATE',
      [userId],
    );
    return profile;
  }

  private async appendLedger(
    tx: Transaction,
    profile: ProfileRow,
    delta: bigint,
    reference: string,
  ) {
    const balance = checkedBalance(BigInt(profile.balance), delta).toString();
    await tx.query('UPDATE profiles SET balance = $2 WHERE id = $1', [
      profile.id,
      balance,
    ]);
    await tx.query(
      'INSERT INTO ledger(id, user_id, delta, balance, reference) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), profile.id, delta.toString(), balance, reference],
    );
    return balance;
  }
}
