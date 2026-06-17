import { classificarArquivo } from '../_shared/upload/match.ts';

export type ResultadoProcessamento =
  | { tipo: 'ok' }
  | { tipo: 'ja_tinha' }
  | { tipo: 'sem_match' }
  | { tipo: 'capa_ok' }
  | { tipo: 'capa_sem_match' }
  | { tipo: 'capa2_ok' }
  | { tipo: 'capa2_sem_match' }
  | { tipo: 'capa3_ok' }
  | { tipo: 'capa3_sem_match' }
  | { tipo: 'invalido'; erro: string };

export async function processarArquivo(
  file: File,
  userId: string,
  loteId: string,
  admin: any,
): Promise<ResultadoProcessamento> {
  const classificacao = classificarArquivo(file.name);
  if (classificacao.tipo === 'invalido') {
    return { tipo: 'invalido', erro: `Nome fora do padrão: ${file.name}` };
  }

  const bytes = await file.arrayBuffer();

  if (classificacao.tipo === 'capa') {
    const { data: familias, error } = await admin
      .from('familias')
      .select('id, codigo_pai, capa_storage_path')
      .eq('lote_id', loteId)
      .eq('user_id', userId);

    if (error) return { tipo: 'invalido', erro: `DB: ${error.message}` };
    const familia = (familias as any[])?.find(
      (f: any) => f.codigo_pai === classificacao.codigo,
    );
    if (!familia) return { tipo: 'capa_sem_match' };

    const ext = file.name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const path = `${userId}/capas/${classificacao.codigo}.${ext}`;

    const { error: upErr } = await admin.storage
      .from('imagens')
      .upload(path, new Uint8Array(bytes), { contentType: file.type, upsert: true });
    if (upErr) return { tipo: 'invalido', erro: `Storage: ${upErr.message}` };

    await admin.from('familias').update({ capa_storage_path: path }).eq('id', familia.id);

    return { tipo: 'capa_ok' };
  }

  if (classificacao.tipo === 'capa2') {
    const { data: familias, error } = await admin
      .from('familias')
      .select('id, codigo_pai, capa2_storage_path')
      .eq('lote_id', loteId)
      .eq('user_id', userId);

    if (error) return { tipo: 'invalido', erro: `DB: ${error.message}` };
    const familia = (familias as any[])?.find(
      (f: any) => f.codigo_pai === classificacao.codigo,
    );
    if (!familia) return { tipo: 'capa2_sem_match' };

    const ext = file.name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const path = `${userId}/capas2/${classificacao.codigo}.${ext}`;

    const { error: upErr } = await admin.storage
      .from('imagens')
      .upload(path, new Uint8Array(bytes), { contentType: file.type, upsert: true });
    if (upErr) return { tipo: 'invalido', erro: `Storage: ${upErr.message}` };

    await admin.from('familias').update({ capa2_storage_path: path }).eq('id', familia.id);

    return { tipo: 'capa2_ok' };
  }

  if (classificacao.tipo === 'capa3') {
    const { data: familias, error } = await admin
      .from('familias')
      .select('id, codigo_pai, capa3_storage_path')
      .eq('lote_id', loteId)
      .eq('user_id', userId);

    if (error) return { tipo: 'invalido', erro: `DB: ${error.message}` };
    const familia = (familias as any[])?.find(
      (f: any) => f.codigo_pai === classificacao.codigo,
    );
    if (!familia) return { tipo: 'capa3_sem_match' };

    const ext = file.name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const path = `${userId}/capas3/${classificacao.codigo}.${ext}`;

    const { error: upErr } = await admin.storage
      .from('imagens')
      .upload(path, new Uint8Array(bytes), { contentType: file.type, upsert: true });
    if (upErr) return { tipo: 'invalido', erro: `Storage: ${upErr.message}` };

    await admin.from('familias').update({ capa3_storage_path: path }).eq('id', familia.id);

    return { tipo: 'capa3_ok' };
  }

  // classificacao.tipo === 'variacao'
  const { data: variacoes, error } = await admin
    .from('variacoes')
    .select('id, codigo, imagem_path, familias!inner(lote_id, user_id)')
    .eq('codigo', classificacao.codigo)
    .eq('familias.lote_id', loteId)
    .eq('familias.user_id', userId);

  if (error) return { tipo: 'invalido', erro: `DB: ${error.message}` };
  const variacao = (variacoes as any[])?.[0];
  if (!variacao) return { tipo: 'sem_match' };

  const tinhaImagem = !!variacao.imagem_path;
  const ext = file.name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
  const path = `${userId}/${classificacao.codigo}.${ext}`;

  const { error: upErr } = await admin.storage
    .from('imagens')
    .upload(path, new Uint8Array(bytes), { contentType: file.type, upsert: true });
  if (upErr) return { tipo: 'invalido', erro: `Storage: ${upErr.message}` };

  // Ao ganhar foto, a cor que tinha vindo desmarcada por falta de imagem volta para a
  // publicação (re-inclui). Só quando NÃO tinha imagem antes: cor que já tinha foto e
  // foi excluída na mão é decisão do operador e fica preservada.
  const patch = tinhaImagem
    ? { imagem_path: path }
    : { imagem_path: path, excluida_da_publicacao: false };
  await admin.from('variacoes').update(patch).eq('id', variacao.id);

  return { tipo: tinhaImagem ? 'ja_tinha' : 'ok' };
}
