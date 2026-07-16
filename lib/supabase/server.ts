// Client Supabase LATO SERVER (route handler, server component).
// Usa comunque la chiave anon: il server non ha privilegi extra, legge solo
// ciò che le policy RLS espongono pubblicamente e chiama le RPC concesse ad
// anon (get_busy_intervals, create_booking). La service role key non serve
// e non va mai usata qui.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Variabili NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY mancanti (vedi .env.local.example)',
    );
  }
  // Nessuna sessione da persistere: ogni richiesta crea un client usa-e-getta.
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
