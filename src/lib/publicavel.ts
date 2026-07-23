import type { Familia, Variacao, OperacaoML } from './tipos-dominio';

export interface ResultadoPublicavel {
  ok: boolean;
  motivos: string[];
}

// "Casada com o ML" = a cor já existe no anúncio publicado, então um UPDATE só a atualiza (não exige
// foto/cor/preço de novo). Legacy: 1 anúncio com N variações → o sinal é `ml_variation_id`. User
// Products (ADR-0088): cada cor é um item ML próprio e o backend grava `ml_variation_id=null` em todas
// → o sinal é `jaCasadaUP` (SKU ativo em `anuncios_externos_itens`, resolvido no fetch). O OR mantém o
// caminho Legacy byte-a-byte (jaCasadaUP undefined → cai em `mlVariationId` truthy, como antes).
function casadaNoMl(v: Variacao): boolean {
  return !!(v.mlVariationId || v.jaCasadaUP);
}

// Checagens por variação compartilhadas entre familiaPublicavel (motivos longos
// no selo do pai) e criticasVariacao (destaque na linha da cor). Fonte única da
// regra para os dois não divergirem.
function flagsCritica(
  v: Variacao,
  opts: { exigeCor?: boolean } = {},
): { semCor: boolean; semFoto: boolean; semPreco: boolean } {
  const exigeCor = opts.exigeCor ?? true;
  return {
    semCor: exigeCor && !v.cor,
    semFoto: !v.fotoPath,
    semPreco: !v.precoPublicacao || v.precoPublicacao <= 0,
  };
}

export function familiaExigeCor(familia: Familia): boolean {
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  return !(familia.operacao === 'CREATE' && familia.tipoAviamento === 'outro' && incluidas.length === 1);
}

// ADR-0078 F2: preços divergentes entre as cores incluídas. Não bloqueia mais — chaveia a UI
// para o modo "config por faixa" (ConfigGruposPreco) e o roteamento de publicação para o split
// (1 anúncio por faixa). Os botões de LOTE continuam bloqueados na divergência (a ação em lote
// é cega ao preço por cor — configure por faixa dentro da família).
export function familiaPrecosDivergentes(familia: {
  variacoes: Array<Pick<Variacao, 'preco' | 'precoPublicacao' | 'excluidaDaPublicacao'>>;
}): boolean {
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const base = incluidas.length > 0 ? incluidas : familia.variacoes;
  if (base.length === 0) return false;
  const precos = base.map((v) => v.precoPublicacao ?? v.preco);
  return Math.min(...precos) !== Math.max(...precos);
}

// Críticas curtas de uma variação que será publicada como variação plena no ML,
// para destacar a linha da cor na Revisão. Reposição de cor já casada no ML (UPDATE)
// não acusa nada. Uma cor desmarcada por falta de foto (CREATE/cor nova) continua
// acusando "sem foto": é pendência visível que o operador resolve subindo a foto.
export function criticasVariacao(
  v: Variacao,
  operacao: OperacaoML,
  opts: { exigeCor?: boolean } = {},
): string[] {
  // Estoque 0 fica fora da publicação (dorme até repor) → não exige cor/foto/preço.
  // A cor nova zerada nasce desmarcada (ingest) e só precisa estar completa quando
  // ganhar estoque numa próxima planilha. Pendência é só para o que tem estoque.
  if (v.estoque <= 0) return [];
  if (operacao === 'UPDATE' && casadaNoMl(v)) return [];
  const f = flagsCritica(v, opts);
  // Cor desmarcada (excluída): só a falta de FOTO segue como pendência visível; cor/
  // preço só importam para a cor que de fato vai publicar (incluída). Excluída com
  // foto = exclusão deliberada e completa → sem alerta.
  if (v.excluidaDaPublicacao) return f.semFoto ? ['sem foto'] : [];
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

  // Camada 2B (ADR-0052): obrigatórios que a IA não resolveu travam a publicação (CREATE e
  // UPDATE) até o operador completá-los na Revisão — nunca publicar sem os required do ML.
  if (familia.atributosFaltantes && familia.atributosFaltantes.length > 0) {
    motivos.push(`Atributos obrigatórios faltando: ${familia.atributosFaltantes.join(', ')}`);
  }

  if (familia.operacao === 'UPDATE') {
    if (!familia.mlItemId) motivos.push('Sem anúncio publicado para atualizar');
    const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
    const casadas = incluidas.filter(casadaNoMl);
    const novas = incluidas.filter((v) => !casadaNoMl(v));
    if (casadas.length === 0 && novas.length === 0) {
      motivos.push('Nenhuma cor selecionada para atualizar');
    }
    // Cor nova vira variação no anúncio → exige cor + foto + preço (igual CREATE).
    // Estoque 0 fica fora (dorme até repor): não bloqueia a publicação da família.
    for (const v of novas.filter((v) => v.estoque > 0)) {
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
  const exigeCor = familiaExigeCor(familia);
  if (incluidas.length === 0) {
    motivos.push('Nenhuma cor incluída (ao menos 1 obrigatória)');
  }
  // Estoque 0 fica fora (dorme até repor) → não exige cor/foto/preço por cor.
  for (const v of incluidas.filter((v) => v.estoque > 0)) {
    const f = flagsCritica(v, { exigeCor });
    if (f.semCor) motivos.push(`Cor ${v.codigo} sem cor definida`);
    if (f.semFoto) motivos.push(`Cor ${v.cor || v.codigo} sem foto`);
    if (f.semPreco) motivos.push(`Cor ${v.cor || v.codigo} sem preço de publicação`);
  }

  return { ok: motivos.length === 0, motivos };
}

// IDs das famílias que podem ser publicadas — base do "selecionar todos" na
// Revisão (marca/desmarca em lote só as publicáveis, espelhando toggleSelecao).
export function idsPublicaveis(familias: Familia[]): string[] {
  return familias.filter((f) => familiaPublicavel(f).ok).map((f) => f.id);
}

// Lote "já teve publicação": existe ≥1 família publicada (status 'publicado' ou
// já com anúncio no ML). Habilita o atalho para o relatório na Revisão — o lote
// volta para 'revisao' quando ainda restam famílias publicáveis (publish-familia-ml),
// o que esconderia o relatório da última rodada via card do Dashboard.
export function loteTemPublicacao(familias: Familia[]): boolean {
  return familias.some((f) => f.status === 'publicado' || f.mlItemId != null);
}

// "Incompleta" = falta de DADOS que impediria publicar, e que o operador precisa
// corrigir. Distingue-se de "não-publicável": uma família já publicada (ou em
// publicação) não é mais publicável, mas também NÃO é incompleta — está concluída.
// Espelha o selo da linha (familia-row só mostra "Incompleta" quando !publicado).
export function familiaIncompleta(familia: Familia): boolean {
  if (familia.status === 'publicado' || familia.status === 'publicando') return false;
  return !familiaPublicavel(familia).ok;
}

// Aviso (NÃO bloqueia — ADR-0018): família sem dimensões reais → o ML estima o
// frete (e pode moderar por frete desproporcional). Olha a variação representativa
// (principal, ou 1ª incluída), espelhando a regra da publicação.
// Piso 0,2cm espelha `dimensoesValidas` do backend (adendo ADR-0018 2026-06-09):
// descarta o placeholder 0,1cm sem matar dimensões reais finas (ex.: fita 0,7cm).
const PISO_MEDIDA_CM = 0.2;
export function familiaSemDimensoesValidas(familia: Familia): boolean {
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  if (incluidas.length === 0) return false;
  const rep = incluidas.find((v) => v.codigo === familia.variacaoPrincipalCodigo) ?? incluidas[0];
  const medidasOk = [rep.alturaCm, rep.larguraCm, rep.comprimentoCm].every((x) => x != null && x >= PISO_MEDIDA_CM);
  const pesoOk = rep.pesoGramas != null && rep.pesoGramas >= 1;
  return !(medidasOk && pesoOk);
}

// Variações de uma reposição (UPDATE) cujo estoque mudou de fato: casada, incluída,
// COM estoque anterior conhecido e valor diferente. A cor NOVA tem `estoqueAnterior`
// null — após publicada ela ganha `mlVariationId`, mas continua não sendo reposição;
// sem o guard `!= null` ela voltaria no diff como "null → X" (a "lista gigante" pós-
// publicação). Fonte única do DiffEstoque e do resumo na linha.
// ADR-0088: `casadaNoMl` (não só `mlVariationId`) para o diff enxergar as cores de família UP
// (mlVariationId sempre null). Display-only, não regride Legacy (jaCasadaUP undefined lá). O diff
// segue dependendo de `estoqueAnterior` estar populado no reingest — cor sem anterior não entra.
export function variacoesEstoqueAlterado(familia: Familia): Variacao[] {
  if (familia.operacao !== 'UPDATE') return [];
  return familia.variacoes.filter(
    (v) =>
      casadaNoMl(v) &&
      !v.excluidaDaPublicacao &&
      v.estoqueAnterior != null &&
      v.estoqueAnterior !== v.estoque,
  );
}
