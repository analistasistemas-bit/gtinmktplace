import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase env vars ausentes: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios. Verifique o .env.local.'
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey);
