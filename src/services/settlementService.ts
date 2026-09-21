import type { Repositories } from '../db/repositories/index.js';
import { computeSettlement, type Settlement } from '../domain/money.js';
import type {
  DosugEvent,
  ItemWithReservation,
  Participant,
  TransferRequest,
} from '../domain/types.js';

export interface SettlementView {
  event: DosugEvent;
  participants: Participant[];
  items: ItemWithReservation[];
  settlement: Settlement;
}

export interface RequestTransfersResult {
  /** Запросы, по которым нужно уведомить должников. */
  toNotify: TransferRequest[];
  /** Уже закрытые пары, которые не трогаем. */
  alreadyClosed: number;
  totalKopecks: number;
}

/**
 * Расчёты между участниками: считает раскладку по фактическим суммам и ведёт
 * запросы на перевод (кто кому сколько должен, какие реквизиты переданы,
 * отдадут при встрече или переводом).
 *
 * Сервис не отправляет сообщения — он меняет состояние и возвращает данные,
 * а тексты и отправку делает слой бота.
 */
export class SettlementService {
  constructor(private readonly repos: Repositories) {}

  /** Текущая картина: событие, участники, список покупок и расчёт. */
  async view(event: DosugEvent): Promise<SettlementView> {
    const [participants, items] = await Promise.all([
      this.repos.participants.listByEvent(event.id),
      this.repos.items.listByEvent(event.id),
    ]);
    return {
      event,
      participants,
      items,
      settlement: computeSettlement(
        items.map((item) => ({
          id: item.id,
          title: item.title,
          reservedByUserId: item.reservation?.userId ?? null,
          reservedByName: item.reservation?.userName ?? null,
          paidKopecks: item.reservation?.paidKopecks ?? null,
        })),
        participants
          .filter((participant) => participant.status === 'going' && !participant.waitlisted)
          .map((participant) => ({ userId: participant.userId, name: participant.name })),
      ),
    };
  }

  /**
   * Создаёт/обновляет запросы по текущему расчёту и возвращает те, по которым
   * нужно написать должникам. Уже закрытые пары не переоткрываем.
   */
  async requestTransfers(event: DosugEvent): Promise<RequestTransfersResult> {
    const view = await this.view(event);
    const transfers = view.settlement.transfers;

    const existing = await this.repos.transfers.listByEvent(event.id);
    const closedPairs = new Set(
      existing
        .filter((request) => request.status === 'closed')
        .map((request) => `${request.fromUserId}:${request.toUserId}`),
    );
    const relevant = transfers.filter(
      (transfer) => !closedPairs.has(`${transfer.fromUserId}:${transfer.toUserId}`),
    );

    const saved = await this.repos.transfers.upsertMany(event.id, relevant);
    const toNotify = saved.filter((request) => request.status !== 'closed');

    await Promise.all(
      toNotify
        .filter((request) => request.notifiedAt === null)
        .map((request) => this.repos.transfers.patch(request.id, { notifiedAt: new Date().toISOString() })),
    );

    return {
      toNotify,
      alreadyClosed: existing.filter((request) => request.status === 'closed').length,
      totalKopecks: view.settlement.totalKopecks,
    };
  }

  /**
   * Должник присылает реквизиты: они сохраняются в его профиль и передаются
   * получателю долга.
   */
  async applyDetails(
    requestId: string,
    fromUserId: number,
    bankName: string,
    handle: string,
  ): Promise<{ request: TransferRequest; profileSaved: boolean } | null> {
    const request = await this.repos.transfers.findById(requestId);
    if (!request || request.fromUserId !== fromUserId) return null;

    await this.repos.users.savePaymentDetails(fromUserId, bankName, handle);
    const updated = await this.repos.transfers.patch(requestId, {
      mode: 'transfer',
      status: 'details_sent',
      detailsSentAt: new Date().toISOString(),
    });
    return updated ? { request: updated, profileSaved: true } : null;
  }

  /** Договорились отдать при встрече. */
  async markInPerson(
    requestId: string,
    fromUserId: number,
  ): Promise<TransferRequest | null> {
    const request = await this.repos.transfers.findById(requestId);
    if (!request || request.fromUserId !== fromUserId) return null;
    return this.repos.transfers.patch(requestId, { mode: 'in_person', status: 'in_person' });
  }

  /** Должник отметил, что перевёл деньги. */
  async markPaid(requestId: string, fromUserId: number): Promise<TransferRequest | null> {
    const request = await this.repos.transfers.findById(requestId);
    if (!request || request.fromUserId !== fromUserId) return null;
    return this.repos.transfers.patch(requestId, {
      status: 'paid',
      paidAt: new Date().toISOString(),
    });
  }

  /** Получатель подтвердил, что деньги у него. */
  async markReceived(requestId: string, toUserId: number): Promise<TransferRequest | null> {
    const request = await this.repos.transfers.findById(requestId);
    if (!request || request.toUserId !== toUserId) return null;
    return this.repos.transfers.patch(requestId, {
      status: 'closed',
      closedAt: new Date().toISOString(),
    });
  }

  async find(requestId: string): Promise<TransferRequest | null> {
    return this.repos.transfers.findById(requestId);
  }

  listForDebtor(userId: number): Promise<TransferRequest[]> {
    return this.repos.transfers.listForDebtor(userId);
  }

  listForCreditor(userId: number): Promise<TransferRequest[]> {
    return this.repos.transfers.listForCreditor(userId);
  }

  listByEvent(eventId: string): Promise<TransferRequest[]> {
    return this.repos.transfers.listByEvent(eventId);
  }
}
