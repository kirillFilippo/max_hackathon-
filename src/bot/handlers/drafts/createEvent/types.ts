import type { DraftState } from '../../../session.js';

/** Черновик мастера создания события — общий тип для шагов мастера. */
export type CreateEventDraft = Extract<DraftState, { kind: 'create-event' }>;
