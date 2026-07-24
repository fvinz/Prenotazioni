'use client';

// Login del portale admin (esercente e staff). Supabase Auth con email e
// password; niente registrazione self-service per ora: gli account li
// crea la piattaforma (dashboard Supabase + riga in tenant_members).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function LoginAdmin() {
  const router = useRouter();
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function accedi(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setInvio(true);
    setErrore(null);
    const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) {
      setErrore('Email o password non corretti.');
      setInvio(false);
      return;
    }
    router.replace('/admin');
  }

  const campo =
    'w-full rounded-xl border border-sabbia bg-white/60 px-4 py-3 outline-none transition focus:border-terracotta';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4">
      <header className="text-center">
        <p className="font-display text-3xl">
          puntuale<span className="text-terracotta">.</span>
        </p>
        <p className="mt-2 text-sm text-inchiostro/60">Il portale del tuo salone.</p>
      </header>
      <form onSubmit={accedi} className="space-y-3">
        <input name="email" type="email" required placeholder="Email" className={campo} />
        <input name="password" type="password" required placeholder="Password" className={campo} />
        {errore && <p className="text-sm text-terracotta">{errore}</p>}
        <button
          type="submit"
          disabled={invio}
          className="w-full rounded-xl bg-terracotta py-3 font-semibold text-crema transition hover:opacity-90 disabled:opacity-60"
        >
          {invio ? 'Un attimo…' : 'Entra'}
        </button>
      </form>
    </main>
  );
}
