import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Gauge, Registry } from '@prometheus-io/client';
import { DomainError, parse } from '../../../packages/contracts/src/errors.js';
import {
  eventPayloadSchemas,
  type DomainEvent,
} from '../../../packages/contracts/src/events.js';
import { points } from '../../../packages/contracts/src/points.js';
import { logger } from '../../../packages/observability/src/index.js';
import type {
  Database,
  Transaction,
} from '../../../packages/runtime/src/database.js';

export type BetState =
  'funds_pending' | 'accepted' | 'won' | 'lost' | 'rejected';
const id = z.string().uuid();
const submitSchema = z
  .object({ userId: id, amount: z.string(), key: z.string().min(8).max(128) })
  .strict();
const querySchema = z.object({ id, userId: id }).strict();

interface BetRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  amount: string;
  key: string;
  state: BetState;
  payout: string;
  rejection_reason: string | null;
  correlation_id: string;
}

/** Returns the next state; repeated confirmations are safe only after payload checks. */
export function transition(state: BetState, next: BetState): BetState {
  if (state === next) return state;
  const valid =
    (state === 'funds_pending' &&
      (next === 'accepted' || next === 'rejected')) ||
    (state === 'accepted' && (next === 'won' || next === 'lost'));
  if (!valid)
    throw new DomainError(
      'FAILED_PRECONDITION',
      `Cannot transition bet from ${state} to ${next}`,
    );
  return next;
}

function view(row: BetRow) {
  return {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    state: row.state,
    payout: row.payout,
    correlationId: row.correlation_id,
  };
}

export class BetsService {
  readonly metrics = new Registry();
  private readonly log = logger('bets');

  constructor(private readonly db: Database) {
    const states: BetState[] = [
      'funds_pending',
      'accepted',
      'won',
      'lost',
      'rejected',
    ];
    new Gauge<'state'>({
      name: 'bet_outcomes',
      help: 'Persisted bet row count by current state; independent of delivery retries and process restarts',
      labelNames: ['state'],
      registers: [this.metrics],
      async collect() {
        const rows = await db.query<{ state: BetState; count: string }>(
          'SELECT state, count(*)::text AS count FROM bets GROUP BY state',
        );
        const counts = new Map(rows.map((row) => [row.state, row.count]));
        // Only operational aggregates are converted to Prometheus numeric values.
        for (const state of states)
          this.set({ state }, Number(counts.get(state) ?? '0'));
      },
    });
    new Gauge<'statistic'>({
      name: 'bet_settlement_latency_seconds',
      help: 'Persisted won/lost bet time from creation to final state, aggregated over retained bets',
      labelNames: ['statistic'],
      registers: [this.metrics],
      async collect() {
        const [latency] = await db.query<{ mean: string; max: string }>(
          `SELECT COALESCE(avg(EXTRACT(EPOCH FROM (updated_at - created_at))), 0)::text AS mean,
                  COALESCE(max(EXTRACT(EPOCH FROM (updated_at - created_at))), 0)::text AS max
           FROM bets WHERE state IN ('won', 'lost')`,
        );
        this.set({ statistic: 'mean' }, Number(latency?.mean ?? '0'));
        this.set({ statistic: 'max' }, Number(latency?.max ?? '0'));
      },
    });
  }

  async submit(request: unknown, correlationId: string) {
    const input = parse(submitSchema, request);
    const amount = points(input.amount).toString();
    return this.db.transaction(async (tx) => {
      const inserted = await tx.query<BetRow>(
        `INSERT INTO bets(id, user_id, amount, key, state, correlation_id)
        VALUES ($1, $2, $3, $4, 'funds_pending', $5)
        ON CONFLICT (user_id, key) DO NOTHING RETURNING *`,
        [randomUUID(), input.userId, amount, input.key, correlationId],
      );
      const row =
        inserted[0] ??
        (
          await tx.query<BetRow>(
            'SELECT * FROM bets WHERE user_id = $1 AND key = $2 FOR UPDATE',
            [input.userId, input.key],
          )
        )[0];
      if (!row)
        throw new DomainError('INTERNAL', 'Bet command could not be persisted');
      if (row.amount !== amount)
        throw new DomainError(
          'ALREADY_EXISTS',
          'Idempotency key was used for another stake',
        );
      if (inserted.length)
        await tx.emit(
          'bet.requested',
          { betId: row.id, userId: row.user_id, amount, key: input.key },
          correlationId,
        );
      return view(row);
    });
  }

  async getBet(request: unknown, _correlationId = '') {
    const input = parse(querySchema, request);
    const [row] = await this.db.query<BetRow>(
      'SELECT * FROM bets WHERE id = $1 AND user_id = $2',
      [input.id, input.userId],
    );
    if (!row) throw new DomainError('NOT_FOUND', 'Bet not found');
    return view(row);
  }

  async handle(event: DomainEvent, tx: Transaction): Promise<void> {
    if (event.type === 'funds.reserved') {
      const input = parse(eventPayloadSchemas['funds.reserved'], event.payload);
      const value = points(input.amount);
      const row = await this.lockBet(tx, input.betId, input.userId);
      if (row.amount !== value.toString())
        throw new DomainError(
          'INVALID_ARGUMENT',
          'Reserved funds differ from the stake',
        );
      // A late duplicate reservation must not rewind an already settled bet.
      if (
        row.state === 'accepted' ||
        row.state === 'won' ||
        row.state === 'lost'
      )
        return;
      transition(row.state, 'accepted');
      await tx.query(
        "UPDATE bets SET state = 'accepted', updated_at = now() WHERE id = $1",
        [row.id],
      );
      this.preparedTransition(event, row.state, 'accepted');
      await tx.emit(
        'bet.accepted',
        { betId: row.id, userId: row.user_id, amount: row.amount },
        event.correlationId,
      );
      return;
    }
    if (event.type === 'funds.rejected') {
      const input = parse(eventPayloadSchemas['funds.rejected'], event.payload);
      const row = await this.lockBet(tx, input.betId, input.userId);
      if (row.state === 'rejected') {
        if (row.rejection_reason !== input.reason)
          throw new DomainError(
            'ALREADY_EXISTS',
            'Rejection differs from the recorded outcome',
          );
        return;
      }
      transition(row.state, 'rejected');
      await tx.query(
        "UPDATE bets SET state = 'rejected', rejection_reason = $2, updated_at = now() WHERE id = $1",
        [row.id, input.reason],
      );
      this.preparedTransition(event, row.state, 'rejected');
      return;
    }
    if (event.type === 'payout.applied') {
      const input = parse(eventPayloadSchemas['payout.applied'], event.payload);
      const payout = points(input.payout, true);
      if (!input.won && payout !== 0n)
        throw new DomainError(
          'INVALID_ARGUMENT',
          'A losing bet cannot receive a payout',
        );
      const row = await this.lockBet(tx, input.betId, input.userId);
      const state = input.won ? 'won' : 'lost';
      if (row.state === state) {
        if (row.payout !== payout.toString())
          throw new DomainError(
            'ALREADY_EXISTS',
            'Payout differs from the recorded outcome',
          );
        return;
      }
      transition(row.state, state);
      await tx.query(
        'UPDATE bets SET state = $2, payout = $3, updated_at = now() WHERE id = $1',
        [row.id, state, payout.toString()],
      );
      this.preparedTransition(event, row.state, state);
      return;
    }
    throw new DomainError('INVALID_ARGUMENT', 'Unsupported Bets event');
  }

  private preparedTransition(event: DomainEvent, from: BetState, to: BetState) {
    this.log.info(
      {
        event: 'bet_transition_prepared',
        eventId: event.id,
        correlationId: event.correlationId,
        from,
        to,
      },
      'Bet state change prepared inside transaction; event_processed confirms commit',
    );
  }

  private async lockBet(tx: Transaction, betId: string, userId: string) {
    const [row] = await tx.query<BetRow>(
      'SELECT * FROM bets WHERE id = $1 FOR UPDATE',
      [betId],
    );
    if (!row)
      throw new DomainError('FAILED_PRECONDITION', 'Bet has not been received');
    if (row.user_id !== userId)
      throw new DomainError(
        'INVALID_ARGUMENT',
        'Event user differs from the bet owner',
      );
    return row;
  }
}
