import { describe, it, expect } from 'vitest';
import { normalizzaTelefonoE164 } from './phone';

describe('normalizzaTelefonoE164', () => {
  it('numero mobile italiano senza prefisso -> +39', () => {
    expect(normalizzaTelefonoE164('333 123 4567')).toBe('+393331234567');
  });

  it('spazi, trattini e prefisso già presente non cambiano il risultato', () => {
    expect(normalizzaTelefonoE164('+39 333-123-4567')).toBe('+393331234567');
    expect(normalizzaTelefonoE164('  3331234567 ')).toBe('+393331234567');
  });

  it('il formato 00 internazionale è equivalente al +', () => {
    expect(normalizzaTelefonoE164('0039 333 123 4567')).toBe('+393331234567');
  });

  it('un numero estero col suo prefisso resta nel suo paese', () => {
    expect(normalizzaTelefonoE164('+44 7911 123456')).toBe('+447911123456');
  });

  it('input non valido -> null', () => {
    expect(normalizzaTelefonoE164('ciao')).toBeNull();
    expect(normalizzaTelefonoE164('123')).toBeNull();
    expect(normalizzaTelefonoE164('')).toBeNull();
  });
});
