import type {
  EventPayload,
  EventType,
} from '../../packages/contracts/src/events.js';

const id = 'fa7b6619-8e46-4b57-aec7-e5d6b0a83c38';
const betId = '7f73734c-8f71-4f1b-b753-220476cf72e0';

export const eventPayloadExamples: { [T in EventType]: EventPayload<T> } = {
  'identity.registered': { id, email: 'player@example.test' },
  'profile.created': { id },
  'bet.requested': { betId, userId: id, amount: '100', key: 'request-key' },
  'funds.reserved': { betId, userId: id, amount: '100' },
  'funds.rejected': { betId, userId: id, reason: 'insufficient_points' },
  'bet.accepted': { betId, userId: id, amount: '100' },
  'bet.settled': { betId, userId: id, won: true, payout: '10' },
  'payout.applied': { betId, userId: id, won: true, payout: '10' },
};

export const eventEnvelopeExample = {
  id: 'aef5d8fa-2090-418d-a465-aa9d77596b42',
  schemaVersion: 1,
  correlationId: '48a30712-0eaf-43e4-b96a-49b6ee9e6a2f',
  occurredAt: '2026-09-16T00:00:00.000Z',
} as const;
