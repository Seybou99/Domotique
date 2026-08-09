import type { ErrorCode } from '@domotique/contract';

/**
 * Erreur applicative. Le code fait foi côté app (le design system §14 impose une
 * formulation factuelle avec une action possible) ; le message n'est qu'un
 * complément pour les journaux.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly retryAfterS?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  rate_limited: 429,
  unit_offline: 409,
  command_timeout: 504,
  device_rejected: 502,
  connector_quota_exceeded: 429,
  third_party_reauth_required: 409,
  third_party_region_mismatch: 409,
  internal_error: 500,
};

export function statusFor(code: ErrorCode): number {
  return STATUS[code];
}

export const unauthorized = (m = 'Authentification requise') => new AppError('unauthorized', m);
export const forbidden = (m = 'Accès refusé à cette ressource') => new AppError('forbidden', m);
export const notFound = (m = 'Ressource introuvable') => new AppError('not_found', m);
export const conflict = (m: string) => new AppError('conflict', m);
