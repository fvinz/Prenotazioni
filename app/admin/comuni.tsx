'use client';

// Pezzi condivisi del portale admin: hook di accesso (sessione, salone,
// ruolo) e intestazione con la navigazione tra le sezioni.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export interface Salone {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

export type Ruolo = 'owner' | 'staff';

export const CAMPO =
  'w-full rounded-xl border border-sabbia bg-carta/60 px-4 py-3 outline-none transition focus:border-terracotta';

/** Guardia di accesso + salone e ruolo dell'utente corrente. */
export function useSalone() {
  const router = useRouter();
  const [salone, setSalone] = useState<Salone | null>(null);
  const [ruolo, setRuolo] = useState<Ruolo>('staff');
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/admin/login');
        return;
      }
      const { data: membership, error } = await supabase
        .from('tenant_members')
        .select('role, tenants(id, name, slug, timezone)')
        .limit(1)
        .maybeSingle();
      const tenant = (membership?.tenants ?? null) as unknown as Salone | null;
      if (error || !tenant) {
        setErrore('Nessun salone associato a questo account.');
        return;
      }
      setSalone(tenant);
      setRuolo(membership!.role === 'owner' ? 'owner' : 'staff');
    })();
  }, [router]);

  return { salone, ruolo, errore };
}

export function Intestazione({ salone, ruolo }: { salone: Salone; ruolo?: Ruolo }) {
  const pathname = usePathname();
  const router = useRouter();
  const [copiato, setCopiato] = useState(false);

  async function esci() {
    await getSupabaseBrowserClient().auth.signOut();
    router.replace('/admin/login');
  }

  async function copiaLinkWidget() {
    await navigator.clipboard.writeText(`${window.location.origin}/${salone.slug}`);
    setCopiato(true);
    setTimeout(() => setCopiato(false), 2000);
  }

  const sezioni = [
    { href: '/admin', label: 'Agenda' },
    { href: '/admin/clienti', label: 'Clienti' },
    // Metriche e configurazione sono del titolare (e il DB lo impone comunque).
    ...(ruolo === 'owner'
      ? [
          { href: '/admin/metriche', label: 'Metriche' },
          { href: '/admin/impostazioni', label: 'Impostazioni' },
        ]
      : []),
  ];

  return (
    <header className="mb-6">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-display text-2xl">
            puntuale<span className="text-terracotta">.</span>
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">{salone.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <button
            onClick={copiaLinkWidget}
            title="Copia il link pubblico di prenotazione"
            className="flex items-center gap-1.5 rounded-xl bg-terracotta px-3.5 py-2 text-sm font-semibold text-crema shadow-sm transition hover:opacity-90"
          >
            🔗 {copiato ? 'Copiato ✓' : 'Link prenotazioni'}
          </button>
          <button onClick={esci} className="text-sm text-inchiostro/50 hover:text-terracotta hover:underline">
            Esci
          </button>
        </div>
      </div>
      <nav className="mt-4 flex gap-2">
        {sezioni.map((s) => {
          const attiva = s.href === '/admin' ? pathname === '/admin' : pathname.startsWith(s.href);
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
                attiva
                  ? 'bg-inchiostro text-crema'
                  : 'bg-carta/60 text-inchiostro hover:bg-sabbia'
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
