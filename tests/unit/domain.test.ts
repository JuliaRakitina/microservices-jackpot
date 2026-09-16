import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transition, type BetState } from '../../apps/bets/src/service.js';
import {
  decideSettlement,
  systemSelector,
} from '../../apps/jackpot/src/service.js';
import {
  checkedBalance,
  validateSettlement,
} from '../../apps/users/src/service.js';
import {
  MAX_POINTS,
  contribution,
  points,
} from '../../packages/contracts/src/points.js';

test('points remain exact above the JavaScript safe-integer range', () => {
  assert.equal(points('9007199254740993'), 9007199254740993n);
  assert.equal(checkedBalance(9007199254740993n, 1n), 9007199254740994n);
  assert.equal(points(MAX_POINTS.toString()), MAX_POINTS);
});

test('point boundaries reject noncanonical, fractional, negative and overflowing inputs', () => {
  for (const value of [
    '01',
    '1.0',
    '-1',
    '1e3',
    '+1',
    ' 1',
    '0',
    '',
    '9223372036854775808',
    1,
    null,
  ]) {
    assert.throws(() => points(value));
  }
  assert.equal(points('0', true), 0n);
  assert.throws(() => checkedBalance(0n, -1n));
  assert.throws(() => checkedBalance(MAX_POINTS, 1n));
});

test('ten-percent contribution uses explicitly rounded-down integer points', () => {
  assert.equal(contribution(1n), 0n);
  assert.equal(contribution(9n), 0n);
  assert.equal(contribution(10n), 1n);
  assert.equal(contribution(19n), 1n);
  assert.equal(contribution(9007199254740993n), 900719925474099n);
});

test('losing stake adds its contribution without creating a payout', () => {
  assert.deepEqual(decideSettlement(19n, 100n, { won: false, draw: 99 }), {
    contribution: 1n,
    payout: 0n,
    balance: 101n,
  });
  assert.equal(validateSettlement(false, '0'), 0n);
  assert.throws(() => validateSettlement(false, '1'));
});

test('winning stake includes its own contribution and atomically empties the pool', () => {
  assert.deepEqual(decideSettlement(29n, 100n, { won: true, draw: 0 }), {
    contribution: 2n,
    payout: 102n,
    balance: 0n,
  });
  assert.equal(validateSettlement(true, '102'), 102n);
});

test('winner boundary rejects inconsistent and out-of-range selector results', () => {
  for (const selection of [
    { won: true, draw: 2 },
    { won: false, draw: 0 },
    { won: false, draw: -1 },
    { won: false, draw: 100 },
    { won: false, draw: 1.5 },
  ]) {
    assert.throws(() => decideSettlement(10n, 0n, selection));
  }
  assert.throws(() =>
    decideSettlement(10n, MAX_POINTS, { won: false, draw: 1 }),
  );
});

test('system selector returns an auditable bounded integer outcome', () => {
  const value = systemSelector({
    betId: 'test',
    round: '1',
    stake: 10n,
    pool: 0n,
  });
  assert.ok(
    Number.isInteger(value.draw) && value.draw >= 0 && value.draw < 100,
  );
  assert.equal(value.won, value.draw === 0);
});

test('bet transitions enumerate only the persisted workflow and idempotent repeats', () => {
  const states: BetState[] = [
    'funds_pending',
    'accepted',
    'rejected',
    'won',
    'lost',
  ];
  const legal = new Set([
    'funds_pending:accepted',
    'funds_pending:rejected',
    'accepted:won',
    'accepted:lost',
  ]);
  for (const from of states)
    for (const to of states) {
      if (from === to || legal.has(`${from}:${to}`))
        assert.equal(transition(from, to), to);
      else assert.throws(() => transition(from, to));
    }
});
