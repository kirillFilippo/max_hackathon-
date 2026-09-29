import type { MemoryStore } from './store.js';
import {
  emptyDeletions,
  MEMORY_SNAPSHOT_VERSION,
  type MemorySnapshot,
} from './types.js';

/**
 * Снимок состояния памяти и его загрузка.
 *
 * Вынесено из `store.ts`, чтобы хранилище занималось состоянием и доступом к
 * нему, а формат снимка — тем, что уезжает в PostgreSQL и в офлайн-файл.
 * Функции работают через публичные методы хранилища: внутренние карты им не нужны.
 */

/** Список из снимка: JSON с диска может прийти неполным. */
const snapshotList = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);

/** Снимок для синхронизации в PostgreSQL и сохранения на диск. */
export const takeSnapshot = (store: MemoryStore): MemorySnapshot => ({
  version: MEMORY_SNAPSHOT_VERSION,
  events: store.events(),
  participants: store.participants(),
  items: store.items(),
  reservations: store.reservations(),
  templates: store.templates(),
  users: store.users(),
  deletions: store.pendingDeletions(),
});

/**
 * Загружает снимок вместо текущего состояния и перестраивает все индексы.
 *
 * Удаления загружаем последними: снимок мог быть создан версией без них, а
 * `put*` выше снимает надгробия у тех сущностей, что снова появились.
 */
export const restoreSnapshot = (store: MemoryStore, snapshot: MemorySnapshot): void => {
  store.clear();

  const reservations = new Map(
    snapshotList(snapshot.reservations).map((reservation) => [reservation.itemId, reservation]),
  );
  for (const event of snapshotList(snapshot.events)) store.putEvent(event);
  for (const participant of snapshotList(snapshot.participants)) store.putParticipant(participant);
  for (const item of snapshotList(snapshot.items)) {
    store.putItem({ ...item, reservation: reservations.get(item.id) ?? null });
  }
  for (const template of snapshotList(snapshot.templates)) store.putTemplate(template);
  for (const user of snapshotList(snapshot.users)) store.putUser(user);

  store.loadDeletions(snapshot.deletions ?? emptyDeletions());
};
