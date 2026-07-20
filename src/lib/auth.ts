import { supabase } from './supabase';
import { limparUrlsImagem } from '@/hooks/useImageUrl';

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  // As URLs assinadas guardadas valem 7 dias (ADR-0081) e são bearer token: sem isso, quem
  // usasse a máquina depois do logout abriria as fotos até elas vencerem.
  limparUrlsImagem();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/#/definir-senha`,
  });
  if (error) throw error;
}
