import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

interface ResultadoUpload {
  ok: number;
  ja_tinha: number;
  sem_match: number;
  erros: Array<{ arquivo: string; motivo: string }>;
}

const EXT_REGEX = /\.(jpe?g|png)$/i;
const CODIGO_REGEX = /^(\d{8})\./;

function extrairCodigo(nomeArquivo: string): string | null {
  const m = nomeArquivo.match(CODIGO_REGEX);
  return m ? m[1] : null;
}

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
  const resultado: ResultadoUpload = { ok: 0, ja_tinha: 0, sem_match: 0, erros: [] };

  for (const arq of arquivos) {
    if (!EXT_REGEX.test(arq.name)) {
      resultado.erros.push({ arquivo: arq.name, motivo: 'Extensão não suportada' });
      continue;
    }
    const codigo = extrairCodigo(arq.name);
    if (!codigo) {
      resultado.erros.push({ arquivo: arq.name, motivo: 'Nome fora do padrão 00CODIGO.ext' });
      continue;
    }

    const { data: variacoes, error } = await admin
      .from('variacoes')
      .select('id, imagem_path, familia_id, familias!inner(lote_id, user_id)')
      .eq('codigo', codigo)
      .eq('familias.lote_id', loteId)
      .eq('familias.user_id', u.id);
    if (error) {
      resultado.erros.push({ arquivo: arq.name, motivo: `DB: ${error.message}` });
      continue;
    }
    const variacao = variacoes?.[0];
    if (!variacao) {
      resultado.sem_match++;
      continue;
    }

    const tinhaImagem = !!variacao.imagem_path;
    const ext = arq.name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const path = `${u.id}/${codigo}.${ext}`;

    const { error: upErr } = await admin.storage
      .from('imagens')
      .upload(path, arq, { contentType: arq.type, upsert: true });
    if (upErr) {
      resultado.erros.push({ arquivo: arq.name, motivo: `Storage: ${upErr.message}` });
      continue;
    }

    await admin.from('variacoes').update({ imagem_path: path }).eq('id', variacao.id);

    if (tinhaImagem) resultado.ja_tinha++;
    else resultado.ok++;
  }

  return new Response(JSON.stringify(resultado), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
