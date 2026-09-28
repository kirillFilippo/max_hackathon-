import type { DosugEvent, TransferRequest } from '../../../../domain/types.js';
import type { AppDeps } from '../../../deps.js';

export const nameResolver = (participants: Array<{ userId: number; name: string }>) => {
  const map = new Map(participants.map((participant) => [participant.userId, participant.name]));
  return (userId: number): string => map.get(userId) ?? `id${userId}`;
};

/** Панель расчётов по событию. */
