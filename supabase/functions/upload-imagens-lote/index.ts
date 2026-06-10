import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';
import { processarArquivo } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Missing auth', { status: 401, headers: corsHeaders });
  }
  const jwt = auth.slice(7);
  const user = userClient(jwt);
  const { data: { user: u } } = await user.auth.getUser();
  if (!u) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response('Invalid form-data', { status: 400, headers: corsHeaders });
  }

  const loteId = formData.get('lote_id');
  if (typeof loteId !== 'string') {
    return new Response('lote_id obrigatório', { status: 400, headers: corsHeaders });
  }

  const arquivos = formData.getAll('files').filter((v): v is File => v instanceof File);
  if (arquivos.length === 0) {
    return new Response('Nenhum arquivo enviado', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  const contadores = {
    ok: 0,
    ja_tinha: 0,
    sem_match: 0,
    capas_ok: 0,
    capas_sem_match: 0,
    capas2_ok: 0,
    capas2_sem_match: 0,
    capas3_ok: 0,
    capas3_sem_match: 0,
    erros: [] as string[],
  };

  for (const file of arquivos) {
    const r = await processarArquivo(file, u.id, loteId, admin);
    switch (r.tipo) {
      case 'ok':            contadores.ok++;              break;
      case 'ja_tinha':      contadores.ja_tinha++;        break;
      case 'sem_match':     contadores.sem_match++;       break;
      case 'capa_ok':       contadores.capas_ok++;        break;
      case 'capa_sem_match': contadores.capas_sem_match++; break;
      case 'capa2_ok':       contadores.capas2_ok++;        break;
      case 'capa2_sem_match': contadores.capas2_sem_match++; break;
      case 'capa3_ok':       contadores.capas3_ok++;        break;
      case 'capa3_sem_match': contadores.capas3_sem_match++; break;
      case 'invalido':      contadores.erros.push(r.erro); break;
    }
  }

  return new Response(JSON.stringify(contadores), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
