import { AppError } from '../http/errors.js';
import type { RateLimiter } from '../state/pairing.js';

/**
 * Budget d'appels aux API tierces (CDC §6.5).
 *
 * Le quota d'un projet cloud Tuya est **global à tous les foyers** : une
 * automatisation emballée chez un client consommerait le budget de toute la
 * plateforme. Le plafond par compte protège les autres clients, le plafond
 * global protège la facture.
 *
 * L'ordre de grandeur importe : l'essai gratuit Tuya plafonne à 0,20 USD par
 * mois de ressources. Une scrutation toutes les 30 secondes représente 2 880
 * appels par jour et par appareil — d'où la scrutation désactivée par défaut et
 * ce budget qui coupe avant la facture.
 */
export type BudgetLimits = {
  /** Appels autorisés par compte lié, par fenêtre. */
  perAccount: number;
  /** Appels autorisés tous comptes confondus, par fenêtre. */
  global: number;
  windowS: number;
};

export const DEFAULT_LIMITS: BudgetLimits = {
  perAccount: 600,
  global: 5_000,
  windowS: 3_600,
};

export class CallBudget {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly provider: string,
    private readonly limits: BudgetLimits = DEFAULT_LIMITS,
  ) {}

  /**
   * Réserve un appel. Renvoie le nombre de secondes à attendre si le budget est
   * épuisé, `null` sinon.
   *
   * Le plafond global est vérifié **en premier** : dépasser le budget de la
   * plateforme est plus grave que le dépassement d'un compte, et on ne veut pas
   * qu'un compte consomme son quota pour rien alors que tout est déjà bloqué.
   */
  async reserve(accountId: string): Promise<number | null> {
    const globalWait = await this.limiter.hit(
      `budget:${this.provider}`,
      this.limits.global,
      this.limits.windowS,
    );
    if (globalWait !== null) return globalWait;

    return this.limiter.hit(
      `budget:${this.provider}:${accountId}`,
      this.limits.perAccount,
      this.limits.windowS,
    );
  }

  /** Variante qui lève — pour les appels déclenchés par une action utilisateur. */
  async require(accountId: string): Promise<void> {
    const wait = await this.reserve(accountId);
    if (wait !== null) {
      // Le CDC §6.5 demande une dégradation explicite plutôt qu'une erreur
      // opaque : le code porte le délai, l'app peut en faire un message utile.
      throw new AppError(
        'connector_quota_exceeded',
        `Budget d’appels ${this.provider} atteint`,
        undefined,
        wait,
      );
    }
  }
}
