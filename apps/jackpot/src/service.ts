import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { DomainError, parse } from '../../../packages/contracts/src/errors.js';
import {
  eventPayloadSchemas,
  type DomainEvent,
} from '../../../packages/contracts/src/events.js';
import {
  contribution,
  MAX_POINTS,
  points,
} from '../../../packages/contracts/src/points.js';
import type {
  Database,
  Transaction,
} from '../../../packages/runtime/src/database.js';

export interface SelectionContext {
  betId: string;
  round: string;
  stake: bigint;
  pool: bigint;
}
export interface Selection {
  won: boolean;
  draw: number;
}
export type WinnerSelector = (context: SelectionContext) => Selection;
export const systemSelector: WinnerSelector = () => {
  const draw = randomInt(100);
  return { won: draw === 0, draw };
};
const poolSchema = z.object({}).strict();
interface PoolRow extends Record<string, unknown> {
  balance: string;
  round: string;
}
interface SettlementRow extends Record<string, unknown> {
  user_id: string;
  stake: string;
}

export function decideSettlement(
  stake: bigint,
  pool: bigint,
  selection: Selection,
) {
  if (stake <= 0n || stake > MAX_POINTS || pool < 0n || pool > MAX_POINTS)
    throw new DomainError(
      'INVALID_ARGUMENT',
      'Points are outside the permitted range',
    );
  if (
    !Number.isInteger(selection.draw) ||
    selection.draw < 0 ||
    selection.draw > 99 ||
    selection.won !== (selection.draw === 0)
  ) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'Winner selector returned an invalid outcome',
    );
  }
  const added = contribution(stake);
  const total = pool + added;
  if (total > MAX_POINTS)
    throw new DomainError(
      'FAILED_PRECONDITION',
      'Pool would exceed its permitted range',
    );
  return {
    contribution: added,
    payout: selection.won ? total : 0n,
    balance: selection.won ? 0n : total,
  };
}

export class JackpotService {
  constructor(
    private readonly db: Database,
    private readonly selector: WinnerSelector = systemSelector,
  ) {}

  async getPool(request: unknown = {}, _correlationId = '') {
    parse(poolSchema, request);
    const [pool] = await this.db.query<PoolRow>(
      'SELECT balance, round FROM pool WHERE id = 1',
    );
    if (!pool)
      throw new DomainError(
        'FAILED_PRECONDITION',
        'Pool migration has not been applied',
      );
    return pool;
  }

  async handle(event: DomainEvent, tx: Transaction): Promise<void> {
    if (event.type !== 'bet.accepted')
      throw new DomainError('INVALID_ARGUMENT', 'Unsupported Jackpot event');
    const input = parse(eventPayloadSchemas['bet.accepted'], event.payload);
    const stake = points(input.amount);
    // One row serializes pool contributions, round rollover and winner decisions.
    // Settlement lookup happens after acquiring it so concurrent duplicate deliveries
    // cannot both draw or contribute, even with distinct event IDs.
    const [pool] = await tx.query<PoolRow>(
      'SELECT balance, round FROM pool WHERE id = 1 FOR UPDATE',
    );
    if (!pool)
      throw new DomainError(
        'FAILED_PRECONDITION',
        'Pool migration has not been applied',
      );
    const [settlement] = await tx.query<SettlementRow>(
      'SELECT user_id, stake FROM settlements WHERE bet_id = $1',
      [input.betId],
    );
    if (settlement) {
      if (
        settlement.user_id !== input.userId ||
        settlement.stake !== stake.toString()
      )
        throw new DomainError(
          'ALREADY_EXISTS',
          'Bet identifier was used for another settlement',
        );
      return;
    }
    const balance = BigInt(pool.balance);
    const selection = this.selector({
      betId: input.betId,
      round: pool.round,
      stake,
      pool: balance,
    });
    const result = decideSettlement(stake, balance, selection);
    const round = BigInt(pool.round) + (selection.won ? 1n : 0n);
    if (round > MAX_POINTS)
      throw new DomainError(
        'FAILED_PRECONDITION',
        'Round counter is exhausted',
      );
    await tx.query(
      `INSERT INTO settlements(bet_id, user_id, stake, contribution, round, pool_before, won, draw, algorithm, payout)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.betId,
        input.userId,
        stake.toString(),
        result.contribution.toString(),
        pool.round,
        pool.balance,
        selection.won,
        selection.draw,
        'one-percent-draw-v1',
        result.payout.toString(),
      ],
    );
    await tx.query('UPDATE pool SET balance = $1, round = $2 WHERE id = 1', [
      result.balance.toString(),
      round.toString(),
    ]);
    await tx.emit(
      'bet.settled',
      {
        betId: input.betId,
        userId: input.userId,
        won: selection.won,
        payout: result.payout.toString(),
      },
      event.correlationId,
    );
  }
}
