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
 * Профиль пользователя в БД: имя и контакт для связи.
 * Он переживает перезапуск бота и деплой.
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
}
