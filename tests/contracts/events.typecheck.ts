import type {
  DomainEvent,
  EventType,
} from '../../packages/contracts/src/events.js';
import type { Transaction } from '../../packages/runtime/src/database.js';
import {
  eventEnvelopeExample,
  eventPayloadExamples,
} from './events-fixtures.js';

// This function is intentionally never executed. The normal build/typecheck
// requires each @ts-expect-error to remain an actual rejected producer call.
export function verifyEventTyping(
  transaction: Transaction,
  event: DomainEvent,
  type: EventType,
): void {
  const correlationId = eventEnvelopeExample.correlationId;
  void transaction.emit(
    'identity.registered',
    eventPayloadExamples['identity.registered'],
    correlationId,
  );
  void transaction.emit(
    'bet.requested',
    eventPayloadExamples['bet.requested'],
    correlationId,
  );
  void transaction.emit(
    'identity.registered',
    // @ts-expect-error A discriminator cannot accept another event's payload.
    eventPayloadExamples['bet.settled'],
    correlationId,
  );
  void transaction.emit(
    'identity.registered',
    // @ts-expect-error Registration requires an email as well as an identity ID.
    eventPayloadExamples['profile.created'],
    correlationId,
  );
  void transaction.emit(
    // @ts-expect-error A union discriminator does not establish payload correlation.
    type,
    eventPayloadExamples['identity.registered'],
    correlationId,
  );
  void transaction.emit(
    // @ts-expect-error Unknown discriminators are not valid events.
    'unknown.event',
    eventPayloadExamples['profile.created'],
    correlationId,
  );
  if (event.type === 'identity.registered') {
    const email: string = event.payload.email;
    void email;
    // @ts-expect-error Narrowing an identity event cannot expose settlement fields.
    const payout = event.payload.payout;
    void payout;
  }
}
