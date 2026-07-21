'use client';

// Anagrafica clienti: ricerca per nome o telefono, dettaglio al click.
// I clienti sono di proprietà del salone (RLS: solo membri del tenant).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { CAMPO, Intestazione, useSalone } from '../comuni';

interface Cliente {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  created_at: string;
}

export default function ClientiAdmin() {
  const supabase = getSupabaseBrowserClient();
  const { salone, errore } = useSalone();

  const [query, setQuery] = useState('');
  const [clienti, setClienti] = useState<Cliente[] | null>(null);

  useEffect(() => {
    if (!salone) return;
    const q = query.trim().replace(/[%,]/g, '');
    const timer = setTimeout(async () => {
      let richiesta = supabase
        .from('customers')
        .select('id, first_name, last_name, phone, email, created_at')
        .eq('tenant_id', salone.id)
        .order('first_name')
        .limit(100);
      if (q.length > 0) {
        richiesta = richiesta.or(
          `first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`,
        );
      }
      const { data: rows } = await richiesta;
      setClienti((rows ?? []) as Cliente[]);
    }, 250);
    return () => clearTimeout(timer);
  }, [supabase, salone, query]);

  if (errore) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <p className="rounded-xl bg-sabbia p-4">{errore}</p>
      </main>
    );
  }
  if (!salone) {
    return <main className="p-8 text-center text-inchiostro/60">Un attimo…</main>;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
      <Intestazione salone={salone} />

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per nome o telefono…"
        className={`${CAMPO} mb-4`}
      />

      {clienti === null ? (
        <p className="text-center text-inchiostro/60">Un attimo…</p>
      ) : clienti.length === 0 ? (
        <p className="rounded-xl bg-white/60 p-6 text-center text-inchiostro/60">
          {query ? 'Nessun cliente trovato.' : 'Ancora nessun cliente in anagrafica.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {clienti.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/clienti/${c.id}`}
                className="flex items-baseline justify-between rounded-xl border border-sabbia bg-white/60 px-4 py-3 transition hover:border-terracotta"
              >
                <span className="truncate font-medium">
                  {c.first_name} {c.last_name ?? ''}
                </span>
                <span className="ml-3 shrink-0 font-mono text-sm text-inchiostro/60">
                  {c.phone}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
