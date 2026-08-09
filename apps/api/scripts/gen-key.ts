/**
 * Génère une clé de chiffrement pour `TOKEN_ENCRYPTION_KEY`.
 *
 *   npm run gen:key --workspace api
 *
 * Ne jamais réutiliser la clé d'un autre environnement, et ne jamais la
 * committer : `.env.example` ne doit contenir qu'un marqueur.
 */
import { generateKey } from '../src/crypto/tokens.js';

console.log(generateKey());
