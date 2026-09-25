import type { IncomingMessage, ServerResponse } from 'node:http';

/** Мелкие помощники HTTP: ответ JSON и чтение тела с ограничением размера. */

export const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
};

export const readBody = async (req: IncomingMessage, limit = 64 * 1024): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Слишком большой запрос');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};
