// One-off: gera um access_token real para um usuário existente via magic link admin (nunca cria
// usuário novo, nunca altera senha) — usado para exercitar o pipeline real do PubliAI (cadastro
// manual → process-familia → Revisão → publish-familia-ml) como o próprio operador faria.
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-net --allow-env scripts/ops/gerar-sessao-usuario.ts <user_id>

import { createClient } from 'jsr:@supabase/supabase-js@2';

const [userId] = Deno.args;
if (!userId) { console.error('uso: gerar-sessao-usuario.ts <user_id>'); Deno.exit(1); }

const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, key);

const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
if (userErr || !userData.user?.email) { console.error('getUserById falhou:', userErr); Deno.exit(1); }
const email = userData.user.email;

const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
if (linkErr || !linkData) { console.error('generateLink falhou:', linkErr); Deno.exit(1); }

const hashedToken = linkData.properties.hashed_token;
const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
const { data: sessionData, error: verifyErr } = await anon.auth.verifyOtp({ token_hash: hashedToken, type: 'email' });
if (verifyErr || !sessionData.session) { console.error('verifyOtp falhou:', verifyErr); Deno.exit(1); }

console.log(sessionData.session.access_token);
