// ADR-0199 (Task 13): ações da tela Gerenciar kit. Cada operação é UMA RPC (`kit_variacao_gerenciar`): confere
// `kits_variacao.versao` sob o lock do kit, relê o estado e aplica política e transferência na mesma transação. Nenhuma
// escrita direta de quantidade: montar e desmontar viram transferência da saga, com chave estável por operação (a
// repetição devolve a transferência original). Desmontar + desligar "Vender só em kit" vai numa chamada: a RPC desliga a
// política antes de a transferência capturar a soma de versões, então a saga não aborta a desmontagem.
//
// Aqui: validação do pedido, alvos da saga (`alvosDe`), hash da operação e o que enfileirar depois.

export type AcaoKit =
  | 'ligar_so_em_kit' | 'desligar_so_em_kit' | 'ligar_reposicao' | 'desligar_reposicao' | 'alterar_meta'
  | 'montar' | 'desmontar';
const ACOES: AcaoKit[] = ['ligar_so_em_kit', 'desligar_so_em_kit', 'ligar_reposicao', 'desligar_reposicao', 'alterar_meta', 'montar', 'desmontar'];

export interface GerenciarKitInput {
  kitId: string;
  acao: AcaoKit;
  /** `kits_variacao.versao` que a tela leu. Obrigatória em toda operação. */
  versao?: number;
  meta?: number;
  itens?: Array<{ codigo: string; quantidade: number }>;
  /** Montar/desmontar: chave estável da operação (a mesma em toda repetição do mesmo pedido). */
  chave?: string;
  /** Desmontar: desliga também "Vender só em kit" (na mesma transação, antes da transferência). */
  desligarSoEmKit?: boolean;
}

/** Resposta de `kit_variacao_gerenciar`. */
export type RespostaRpcGerenciar =
  | {
    ok: true; existente?: boolean; transferencia_id: string | null; normais?: string[]; reposicao_desligada?: boolean;
    so_em_kit?: boolean; reposicao_auto?: boolean; versao?: number;
  }
  | { ok: false; motivo: string; codigo?: string | null; versao_atual?: number };

export interface DepsGerenciarKit {
  orgId: string;
  /** SKUs do kit na org, com a composição (lista vazia = kit de outra org ou inexistente). */
  skusDoKit(kitId: string): Promise<Array<{ codigo: string; componentes: Array<{ codigo: string; quantidade: number }> }>>;
  /** `alvosDe` da Task 14: código sem user product fica de fora. */
  alvosDe(codigos: string[]): Promise<Array<{ codigo: string; up_id: string; item_ids: string[] }>>;
  rpc(a: {
    kitId: string; acao: AcaoKit; versao: number; chave: string | null; hash: string | null; meta: number | null;
    itens: Array<{ codigo: string; quantidade: number }> | null;
    alvos: Array<{ codigo: string; up_id: string; item_ids: string[] }>; desligarSoEmKit: boolean;
  }): Promise<RespostaRpcGerenciar>;
  enfileirarSaga(transferenciaId: string): Promise<void>;
  enfileirarReposicao(kitId: string): Promise<void>;
}

export type ResultadoGerenciar =
  | {
    ok: true; transferenciaId?: string; normais?: string[]; reposicaoDesligada?: boolean; soEmKit?: boolean;
    existente?: boolean; versao?: number;
  }
  | { ok: false; motivo: string; mensagem?: string };

const MENSAGEM: Record<string, string> = {
  versao: 'O kit mudou em outra tela. Feche e abra de novo para ver o estado atual.',
  kit_nao_encontrado: 'Kit não encontrado.',
  meta_invalida: 'A meta precisa ser um número inteiro, 0 ou mais.',
  so_em_kit_desligado: 'A reposição automática só existe com "Vender só em kit" ligado.',
  up_ocupado: 'Uma peça deste kit está em outra transferência. Tente de novo em alguns minutos.',
  pedido_diferente: 'Esta operação já foi enviada com outras quantidades. Feche e abra de novo.',
  itens_invalidos: 'Informe quantidades inteiras maiores que 0 para combinações deste kit.',
  chave_ausente: 'Pedido sem identificação. Recarregue a tela.',
  acao_invalida: 'Ação desconhecida.',
};
const recusa = (motivo: string, mensagem?: string): ResultadoGerenciar => ({ ok: false, motivo, mensagem: mensagem ?? MENSAGEM[motivo] });

async function sha256(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function gerenciarKit(deps: DepsGerenciarKit, input: GerenciarKitInput): Promise<ResultadoGerenciar> {
  if (!ACOES.includes(input.acao)) return recusa('acao_invalida');
  if (!Number.isInteger(input.versao)) return recusa('versao');
  const transfere = input.acao === 'montar' || input.acao === 'desmontar';
  if (input.acao === 'alterar_meta' && (!Number.isInteger(input.meta) || (input.meta as number) < 0)) return recusa('meta_invalida');
  if (transfere && !input.chave) return recusa('chave_ausente');

  let alvos: Array<{ codigo: string; up_id: string; item_ids: string[] }> = [];
  let itens: Array<{ codigo: string; quantidade: number }> | null = null;
  let hash: string | null = null;
  if (transfere || input.acao === 'ligar_so_em_kit') {
    const skus = await deps.skusDoKit(input.kitId);
    const porCodigo = new Map(skus.map((s) => [s.codigo, s]));
    let codigos: string[];
    if (transfere) {
      itens = input.itens ?? [];
      if (
        itens.length === 0 || new Set(itens.map((i) => i.codigo)).size !== itens.length
        || itens.some((i) => !porCodigo.has(i.codigo) || !Number.isInteger(i.quantidade) || i.quantidade <= 0)
      ) return recusa('itens_invalidos');
      // A RPC exige alvo para cada código movimentado; SKU de kit sem anúncio não recebe montagem por aqui.
      codigos = [...new Set(itens.flatMap((i) => [i.codigo, ...porCodigo.get(i.codigo)!.componentes.map((c) => c.codigo)]))];
      const desligar = input.acao === 'desmontar' && input.desligarSoEmKit === true;
      hash = await sha256(JSON.stringify([
        input.acao, [...itens].sort((a, b) => a.codigo.localeCompare(b.codigo)).map((i) => [i.codigo, i.quantidade]), desligar,
      ]));
    } else {
      codigos = [...new Set(skus.flatMap((s) => s.componentes.map((c) => c.codigo)))];
    }
    alvos = (await deps.alvosDe(codigos)).sort((a, b) => a.codigo.localeCompare(b.codigo));
    const faltando = codigos.filter((c) => !alvos.some((a) => a.codigo === c)).sort();
    if (transfere && faltando.length > 0) {
      return recusa('sku_sem_anuncio', `Sem anúncio no Mercado Livre: ${faltando.join(', ')}. Combinação nova vai por "Combinação ou tamanho novo".`);
    }
  }

  const r = await deps.rpc({
    kitId: input.kitId, acao: input.acao, versao: input.versao as number, chave: transfere ? input.chave! : null, hash,
    meta: input.acao === 'alterar_meta' ? input.meta as number : null, itens, alvos,
    desligarSoEmKit: input.acao === 'desmontar' && input.desligarSoEmKit === true,
  });
  if (!r.ok) return recusa(r.motivo, r.motivo === 'baseline_divergente' || !MENSAGEM[r.motivo] ? `${r.motivo}${r.codigo ? `: ${r.codigo}` : ''}` : undefined);

  if (r.transferencia_id) await deps.enfileirarSaga(r.transferencia_id);
  // Peças que voltaram a Normal: a rodada desfaz as pausas da automação. Meta e reposição ligada: a rodada repõe.
  if ((r.normais?.length ?? 0) > 0 || input.acao === 'desligar_so_em_kit'
    || ((input.acao === 'alterar_meta' || input.acao === 'ligar_reposicao') && r.so_em_kit && r.reposicao_auto)) {
    await deps.enfileirarReposicao(input.kitId);
  }
  return {
    ok: true, transferenciaId: r.transferencia_id ?? undefined, normais: r.normais ?? [], reposicaoDesligada: !!r.reposicao_desligada,
    soEmKit: r.so_em_kit, existente: !!r.existente, versao: r.versao,
  };
}
