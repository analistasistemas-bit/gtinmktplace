import type { Familia, Variacao, OperacaoML } from './tipos-dominio';

export interface ResultadoPublicavel {
  ok: boolean;
  motivos: string[];
}

// Checagens por variação compartilhadas entre familiaPublicavel (motivos longos
// no selo do pai) e criticasVariacao (destaque na linha da cor). Fonte única da
// regra para os dois não divergirem.
function flagsCritica(v: Variacao): { semCor: boolean; semFoto: boolean; semPreco: boolean } {
  return {
    semCor: !v.cor,
    semFoto: !v.fotoPath,
    semPreco: !v.precoPublicacao || v.precoPublicacao <= 0,
  };
}

// Críticas curtas de uma variação que será publicada como variação plena no ML,
// para destacar a linha da cor na Revisão. Só vale p/ cores que viram variação:
// excluída ou reposição de cor já casada no ML (UPDATE) não acusa nada.
export function criticasVariacao(v: Variacao, operacao: OperacaoML): string[] {
  if (v.excluidaDaPublicacao) return [];
  if (operacao === 'UPDATE' && v.mlVariationId) return [];
  const f = flagsCritica(v);
  const out: string[] = [];
  if (f.semCor) out.push('sem cor');
  if (f.semFoto) out.push('sem foto');
  if (f.semPreco) out.push('sem preço');
  return out;
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
      const f = flagsCritica(v);
      if (f.semCor) motivos.push(`Cor nova ${v.codigo} sem cor definida`);
      if (f.semFoto) motivos.push(`Cor nova ${v.cor || v.codigo} sem foto`);
      if (f.semPreco) motivos.push(`Cor nova ${v.cor || v.codigo} sem preço`);
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
    const f = flagsCritica(v);
    if (f.semCor) motivos.push(`Cor ${v.codigo} sem cor definida`);
    if (f.semFoto) motivos.push(`Cor ${v.cor || v.codigo} sem foto`);
    if (f.semPreco) motivos.push(`Cor ${v.cor || v.codigo} sem preço de publicação`);
  }

  return { ok: motivos.length === 0, motivos };
}

// Aviso (NÃO bloqueia — ADR-0018): família sem dimensões reais → o ML estima o
// frete (e pode moderar por frete desproporcional). Olha a variação representativa
// (principal, ou 1ª incluída), espelhando a regra da publicação.
export function familiaSemDimensoesValidas(familia: Familia): boolean {
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  if (incluidas.length === 0) return false;
  const rep = incluidas.find((v) => v.codigo === familia.variacaoPrincipalCodigo) ?? incluidas[0];
  const medidasOk = [rep.alturaCm, rep.larguraCm, rep.comprimentoCm].every((x) => x != null && x >= 1);
  const pesoOk = rep.pesoGramas != null && rep.pesoGramas >= 1;
  return !(medidasOk && pesoOk);
}
