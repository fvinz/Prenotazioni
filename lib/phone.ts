// Normalizzazione dei numeri di telefono in E.164 (es. '+393331234567').
// È il punto critico della dedup clienti per tenant (vedi CLAUDE.md):
// TUTTI i telefoni passano da qui prima di arrivare a create_booking.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Converte l'input dell'utente in E.164. Ritorna null se il numero non è
 * valido. Il prefisso internazionale, se assente, è dedotto dal paese di
 * default (Italia): '333 123 4567' -> '+393331234567'.
 */
export function normalizzaTelefonoE164(
  input: string,
  paeseDefault: CountryCode = 'IT',
): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), paeseDefault);
  return parsed?.isValid() ? parsed.number : null;
}
