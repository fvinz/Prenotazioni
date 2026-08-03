// Informativa privacy pubblica del salone: /{tenantSlug}/privacy.
// Il Salone è titolare del trattamento dei dati dei propri clienti;
// Puntuale è il fornitore tecnico che tratta i dati per suo conto
// (responsabile del trattamento, art. 28 GDPR). Pagina statica lato
// server: legge solo il nome del salone dai dati pubblici del tenant.
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PaginaPrivacy({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = getSupabaseServerClient();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, slug')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (!tenant) notFound();

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
      <header className="mb-10">
        <Link
          href={`/${tenant.slug}`}
          className="font-display text-lg text-inchiostro/50 transition hover:text-terracotta"
        >
          puntuale<span className="text-terracotta">.</span>
        </Link>
        <h1 className="mt-3 font-display text-4xl tracking-tight">Informativa privacy</h1>
        <p className="mt-2 text-sm text-inchiostro/60">{tenant.name}</p>
      </header>

      <div className="space-y-8 text-sm leading-relaxed text-inchiostro/80">
        <section>
          <h2 className="mb-2 font-display text-xl text-inchiostro">Titolare del trattamento</h2>
          <p>
            Il titolare del trattamento dei tuoi dati è <strong>{tenant.name}</strong>. È il
            salone che decide come e perché i tuoi dati vengono usati: per qualsiasi richiesta
            sui tuoi dati puoi rivolgerti direttamente a loro, ai contatti che trovi sul loro
            sito o sui loro canali social.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl text-inchiostro">Quali dati raccogliamo</h2>
          <p>Quando prenoti un appuntamento ci lasci:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>nome e cognome;</li>
            <li>numero di cellulare;</li>
            <li>email, solo se scegli di lasciarla (è facoltativa);</li>
            <li>data, ora e servizio prenotato.</li>
          </ul>
          <p className="mt-2">Nient&apos;altro: nessun dato di pagamento passa da questo modulo.</p>
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl text-inchiostro">Perché li usiamo</h2>
          <p>
            Solo per gestire il tuo appuntamento: confermarlo, permetterti di annullarlo o
            spostarlo tramite il link personale che ricevi, e farti riconoscere dal salone se
            prenoti di nuovo. Non li usiamo per marketing, non li vendiamo e non li condividiamo
            con altre attività.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl text-inchiostro">Chi tratta i tuoi dati</h2>
          <p>
            Il sistema di prenotazione è fornito da <strong>Puntuale</strong>, che tratta i tuoi
            dati per conto del salone, seguendo le sue istruzioni, come previsto dall&apos;art. 28
            del Regolamento (UE) 2016/679 (GDPR). I dati sono ospitati su infrastrutture con sede
            nell&apos;Unione Europea e protetti in modo che ogni salone veda solo i propri
            clienti: i dati di questo salone non sono mai visibili o accessibili ad altri saloni
            che usano lo stesso sistema.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl text-inchiostro">Base giuridica</h2>
          <p>
            Trattiamo i tuoi dati perché necessari all&apos;esecuzione di un accordo di cui sei
            parte — la prenotazione stessa — ai sensi dell&apos;art. 6.1.b del GDPR.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl text-inchiostro">Per quanto tempo</h2>
          <p>
            Conserviamo i tuoi dati finché resti cliente del salone, per permettergli di gestire
            lo storico dei tuoi appuntamenti. Puoi chiedere in qualsiasi momento la cancellazione,
            come spiegato più sotto.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl text-inchiostro">Cookie</h2>
          <p>
            Questa pagina non usa cookie di profilazione né strumenti di analisi o pubblicità di
            terze parti.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl text-inchiostro">I tuoi diritti</h2>
          <p>
            Puoi chiedere in qualsiasi momento di accedere ai tuoi dati, correggerli o farli
            cancellare, oppure opporti al loro trattamento: basta contattare direttamente{' '}
            {tenant.name}. Hai anche diritto a proporre reclamo al Garante per la protezione dei
            dati personali (www.garanteprivacy.it).
          </p>
        </section>
      </div>
    </main>
  );
}
