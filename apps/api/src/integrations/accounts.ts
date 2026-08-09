import type { PrismaClient } from '@prisma/client';
import { AppError, notFound } from '../http/errors.js';
import type { TokenCipher } from '../crypto/tokens.js';
import type { EventBus } from '../state/events.js';
import type { ProviderRegistry } from './provider.js';

/**
 * Accès aux comptes tiers et à leurs jetons.
 *
 * Extrait des routes : le connecteur en a besoin autant qu'elles, et dupliquer
 * la logique de renouvellement produirait deux comportements divergents le jour
 * où un jeton expire.
 */
export class ThirdPartyAccounts {
  /**
   * Renouvellements en cours, par compte.
   *
   * Sans cette mutualisation, dix commandes simultanées sur dix appareils du
   * même compte déclencheraient dix rafraîchissements concurrents — et Tuya
   * invalide le jeton précédent à chaque rotation, donc neuf échoueraient.
   */
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: ProviderRegistry,
    private readonly cipher: TokenCipher,
    private readonly events: EventBus,
  ) {}

  /**
   * Jeton d'accès du compte, renouvelé si nécessaire.
   *
   * Renvoie `null` pour un compte relié en console (Tuya) : il n'y a pas de
   * jeton utilisateur, les appels se font avec les identifiants du projet.
   */
  async accessToken(accountId: string): Promise<string | null> {
    const account = await this.prisma.thirdPartyAccount.findUnique({ where: { id: accountId } });
    if (!account) throw notFound('Compte tiers introuvable');

    if (this.providers.get(account.provider)?.linkMode === 'console') return null;

    if (account.reauthRequired) {
      throw new AppError('third_party_reauth_required', 'Le compte doit être relié à nouveau');
    }

    // Marge de 60 s : un jeton qui expire pendant l'appel produit une erreur
    // difficile à relier à sa cause.
    if (account.expiresAt.getTime() - Date.now() > 60_000) {
      return this.cipher.decrypt(account.accessTokenEnc);
    }

    const pending = this.refreshing.get(accountId);
    if (pending) return pending;

    const task = this.renew(accountId).finally(() => this.refreshing.delete(accountId));
    this.refreshing.set(accountId, task);
    return task;
  }

  private async renew(accountId: string): Promise<string> {
    const account = await this.prisma.thirdPartyAccount.findUnique({ where: { id: accountId } });
    if (!account) throw notFound('Compte tiers introuvable');

    const provider = this.providers.get(account.provider);
    if (!provider) {
      throw new AppError('internal_error', `Écosystème ${account.provider} non activé`);
    }

    try {
      const renewed = await provider.refresh(this.cipher.decrypt(account.refreshTokenEnc));
      await this.prisma.thirdPartyAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEnc: this.cipher.encrypt(renewed.accessToken),
          refreshTokenEnc: this.cipher.encrypt(renewed.refreshToken),
          keyVersion: this.cipher.currentVersion,
          expiresAt: renewed.expiresAt,
          reauthRequired: false,
        },
      });
      return renewed.accessToken;
    } catch {
      // Le renouvellement a échoué : on le signale à l'app plutôt que de
      // réessayer indéfiniment (écran 5.3, « reconnecter le compte »).
      await this.prisma.thirdPartyAccount.update({
        where: { id: account.id },
        data: { reauthRequired: true },
      });
      await this.events.publish(account.homeId, {
        type: 'integration_reauth_required',
        account_id: account.id,
        provider: account.provider,
      });
      throw new AppError('third_party_reauth_required', 'Le compte doit être relié à nouveau');
    }
  }
}
