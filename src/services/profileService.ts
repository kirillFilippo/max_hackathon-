import type { Repositories } from '../db/repositories/index.js';
import type { UserProfile } from '../domain/types.js';

export interface MaxUserLike {
  user_id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  username?: string | null;
}

export const displayNameOf = (user: MaxUserLike): string =>
  [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.name || `id${user.user_id}`;

/**
 * Профиль пользователя в БД: имя, контакт и реквизиты для перевода.
 * Именно поэтому данные не теряются при перезапуске бота и деплое.
 */
export class ProfileService {
  constructor(private readonly repos: Repositories) {}

  async touchFromMax(user: MaxUserLike): Promise<UserProfile> {
    return this.repos.users.ensure(user.user_id, {
      name: displayNameOf(user),
      username: user.username ?? null,
    });
  }

  async get(userId: number): Promise<UserProfile | null> {
    return this.repos.users.find(userId);
  }

  async saveContact(userId: number, contact: string): Promise<UserProfile> {
    return this.repos.users.saveContact(userId, contact.slice(0, 120));
  }

  async savePaymentDetails(userId: number, bankName: string, handle: string): Promise<UserProfile> {
    return this.repos.users.savePaymentDetails(
      userId,
      bankName.trim().slice(0, 60),
      handle.trim().slice(0, 80),
    );
  }

  hasPaymentDetails(profile: UserProfile | null): boolean {
    return Boolean(profile && profile.bankName.trim() && profile.paymentHandle.trim());
  }
}
