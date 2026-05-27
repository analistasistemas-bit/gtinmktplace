import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url) throw new Error('VITE_SUPABASE_URL não definida');
if (!anon) throw new Error('VITE_SUPABASE_ANON_KEY não definida');

export const supabase = createClient<Database>(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
