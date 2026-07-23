// POST /api/prenotazione/[token]/annulla — annullamento dal link personale
// del cliente. Porta sottile verso cancel_booking_by_token (SECURITY
// DEFINER): la validazione (stato attuale della prenotazione) vive nel
// database.
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.rpc('cancel_booking_by_token', { p_token: token });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
