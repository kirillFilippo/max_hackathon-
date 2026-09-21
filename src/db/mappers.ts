/** Приведение значений PostgreSQL к доменному виду. */

export const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export const toIsoOrNull = (value: Date | string | null | undefined): string | null =>
  value === null || value === undefined ? null : toIso(value);

export const toNumberOrNull = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
