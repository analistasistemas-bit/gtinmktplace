import type { Familia } from './tipos-dominio';

export interface ResultadoPublicavel {
  ok: boolean;
  motivos: string[];
}

export function familiaPublicavel(familia: Familia): ResultadoPublicavel {
  const motivos: string[] = [];

  // 'erro' é re-publicável (retry após falha); só bloqueia status de processamento.
  if (familia.status !== 'pronto' && familia.status !== 'erro') {
    motivos.push('Ainda em processamento (aguarde ficar "pronta")');
  }

  if (familia.operacao === 'UPDATE') {
    if (!familia.mlItemId) motivos.push('Sem anúncio publicado para atualizar');
    const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
    const casadas = incluidas.filter((v) => v.mlVariationId);
    const novas = incluidas.filter((v) => !v.mlVariationId);
    if (casadas.length === 0 && novas.length === 0) {
      motivos.push('Nenhuma cor selecionada para atualizar');
    }
    // Cor nova vira variação no anúncio → exige cor + foto + preço (igual CREATE).
    for (const v of novas) {
      if (!v.cor) motivos.push(`Cor nova ${v.codigo} sem cor definida`);
      if (!v.fotoPath) motivos.push(`Cor nova ${v.cor || v.codigo} sem foto`);
      if (!v.precoPublicacao || v.precoPublicacao <= 0) motivos.push(`Cor nova ${v.cor || v.codigo} sem preço`);
    }
    return { ok: motivos.length === 0, motivos };
  }

  // CREATE: regras completas (categoria, cor, foto, preço por cor).
  if (!familia.categoriaMlId) motivos.push('Categoria indefinida');
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  if (incluidas.length === 0) {
    motivos.push('Nenhuma cor incluída (ao menos 1 obrigatória)');
  }
  for (const v of incluidas) {
    if (!v.cor) motivos.push(`Cor ${v.codigo} sem cor definida`);
    if (!v.fotoPath) motivos.push(`Cor ${v.cor || v.codigo} sem foto`);
    if (!v.precoPublicacao || v.precoPublicacao <= 0) motivos.push(`Cor ${v.cor || v.codigo} sem preço de publicação`);
  }

  return { ok: motivos.length === 0, motivos };
}
