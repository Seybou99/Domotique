/**
 * Simulation du provisionnement en usine (CDC §8.2).
 *
 * Crée un boîtier sans foyer, avec un code d'appairage à usage unique, et
 * imprime le contenu du QR code à apposer dessus. C'est l'étape qui manquait
 * pour pouvoir tester le claim : sans elle, aucun boîtier n'existe à réclamer.
 *
 *   npm run provision:unit --workspace api
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashToken } from '../src/http/auth.js';

const prisma = new PrismaClient();

/** Sans I, O, 0 et 1 : illisibles sur une étiquette imprimée. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function code(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const serial = `DMT-${code(8)}`;
const claimCode = code(10);

const unit = await prisma.deviceUnit.create({
  data: {
    id: randomUUID(),
    serial,
    name: 'Boîtier domotique',
    // En usine, le certificat mTLS serait généré ici et son empreinte stockée.
    certExpiresAt: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000),
    claim: {
      create: {
        codeHash: hashToken(claimCode),
        // Fenêtre large : le boîtier peut rester des mois en stock avant d'être
        // vendu. C'est l'usage unique, pas la brièveté, qui protège ici.
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    },
  },
});

console.log('Boîtier provisionné');
console.log('  id     :', unit.id);
console.log('  serial :', serial);
console.log('');
console.log('Contenu du QR code à apposer sur le boîtier :');
console.log(' ', JSON.stringify({ serial, claim_code: claimCode }));
console.log('');
console.log('Le code n’est stocké que sous forme de hash : il n’est plus lisible après cet appel.');

await prisma.$disconnect();
