// ADR-0197 (Task 13): ações da tela Gerenciar kit. Nenhuma escrita direta de quantidade: montar e desmontar viram
// transferência da saga; "Vender só em kit" usa as funções da Task 14. Mudança de política do kit (meta, reposição,
// "Vender só em kit") faz CAS em `kits_variacao.versao`: a decisão tomada sobre uma tela velha é recusada.
//
// `sku_politica_kit.versao` não é tocada aqui (só pelas RPCs da Task 14): mudar essa soma abortaria transferências
// abertas de outros kits sobre o mesmo SKU (Task 10, decisão 6).
import type { NovaTransferencia } from '../_shared/kit-variacao/saga.ts';
import type { ResultadoDecisao } from '../_shared/kit-variacao/reposicao.ts';

export interface KitGerenciado {
  id: string;
  soEmKit: boolean;
  reposicaoAuto: boolean;
  meta: number;
  versao: number;
}

export type AcaoKit =
  | 'ligar_so_em_kit' | 'desligar_so_em_kit' | 'ligar_reposicao' | 'desligar_reposicao' | 'alterar_meta'
  | 'montar' | 'desmontar';

export interface GerenciarKitInput {
  kitId: string;
  acao: AcaoKit;
  /** `kits_variacao.versao` que a tela leu. Obrigatória em mudança de política. */
  versao?: number;
  meta?: number;
  itens?: Array<{ codigo: string; quantidade: number }>;
}

export interface DepsGerenciarKit {
  orgId: string;
  /** Por id E org: o service role ignora RLS. */
  lerKit(kitId: string): Promise<KitGerenciado | null>;
  skusDoKit(kitId: string): Promise<Array<{ codigo: string; componentes: Array<{ codigo: string; quantidade: number }> }>>;
  /** `alvosDe` da Task 14: código sem user product fica de fora. */
  alvosDe(codigos: string[]): Promise<Array<{ codigo: string; up_id: string; item_ids: string[] }>>;
  /** Grava o patch e `versao + 1` só se a versão ainda for `versao`. */
  casKit(kitId: string, versao: number, patch: Partial<Pick<KitGerenciado, 'reposicaoAuto' | 'meta'>>): Promise<boolean>;
  ligarSoEmKit(kitId: string): Promise<ResultadoDecisao>;
  desligarSoEmKit(kitId: string): Promise<string[]>;
  criarTransferencia(input: NovaTransferencia): Promise<{ id: string } | { motivo: string }>;
  enfileirarSaga(transferenciaId: string): Promise<void>;
  enfileirarReposicao(kitId: string): Promise<void>;
}

export type ResultadoGerenciar =
  | { ok: true; transferenciaId?: string; normais?: string[]; reposicaoDesligada?: boolean; soEmKit?: boolean }
  | { ok: false; motivo: string; mensagem?: string };

const recusa = (motivo: string, mensagem?: string): ResultadoGerenciar => ({ ok: false, motivo, ...(mensagem ? { mensagem } : {}) });
const MSG_VERSAO = 'O kit mudou em outra tela. Feche e abra de novo para ver o estado atual.';

export async function gerenciarKit(deps: DepsGerenciarKit, input: GerenciarKitInput): Promise<ResultadoGerenciar> {
  const kit = await deps.lerKit(input.kitId);
  if (!kit) return recusa('kit_nao_encontrado', 'Kit não encontrado.');

  const cas = async (patch: Partial<Pick<KitGerenciado, 'reposicaoAuto' | 'meta'>>) =>
    Number.isInteger(input.versao) && await deps.casKit(kit.id, input.versao as number, patch);

  switch (input.acao) {
    case 'alterar_meta': {
      if (!Number.isInteger(input.meta) || (input.meta as number) < 0) return recusa('meta_invalida', 'A meta precisa ser um número inteiro, 0 ou mais.');
      if (!(await cas({ meta: input.meta }))) return recusa('versao', MSG_VERSAO);
      if (kit.soEmKit && kit.reposicaoAuto) await deps.enfileirarReposicao(kit.id);
      return { ok: true };
    }
    case 'ligar_reposicao':
    case 'desligar_reposicao': {
      const ligar = input.acao === 'ligar_reposicao';
      if (ligar && !kit.soEmKit) return recusa('so_em_kit_desligado', 'A reposição automática só existe com "Vender só em kit" ligado.');
      if (!(await cas({ reposicaoAuto: ligar }))) return recusa('versao', MSG_VERSAO);
      if (ligar) await deps.enfileirarReposicao(kit.id);
      return { ok: true };
    }
    case 'ligar_so_em_kit': {
      if (!(await cas({}))) return recusa('versao', MSG_VERSAO);
      const r = await deps.ligarSoEmKit(kit.id);
      if (!r.ok) {
        const [motivo] = r.motivo.split(':');
        return recusa(motivo, motivo === 'up_ocupado'
          ? 'Uma peça deste kit está em outra transferência. Tente de novo em alguns minutos.' : undefined);
      }
      return { ok: true, transferenciaId: r.transferenciaId };
    }
    case 'desligar_so_em_kit': {
      if (!(await cas({}))) return recusa('versao', MSG_VERSAO);
      return { ok: true, normais: await deps.desligarSoEmKit(kit.id) };
    }
    case 'montar':
    case 'desmontar':
      return await transferir(deps, kit, input, cas);
    default:
      return recusa('acao_invalida', 'Ação desconhecida.');
  }
}

async function transferir(
  deps: DepsGerenciarKit, kit: KitGerenciado, input: GerenciarKitInput,
  cas: (patch: Partial<Pick<KitGerenciado, 'reposicaoAuto' | 'meta'>>) => Promise<boolean>,
): Promise<ResultadoGerenciar> {
  const skus = await deps.skusDoKit(kit.id);
  const porCodigo = new Map(skus.map((s) => [s.codigo, s]));
  const itens = input.itens ?? [];
  if (
    itens.length === 0 || new Set(itens.map((i) => i.codigo)).size !== itens.length
    || itens.some((i) => !porCodigo.has(i.codigo) || !Number.isInteger(i.quantidade) || i.quantidade <= 0)
  ) return recusa('itens_invalidos', 'Informe quantidades inteiras maiores que 0 para combinações deste kit.');

  // A RPC exige alvo para cada código movimentado. SKU de kit sem anúncio não recebe montagem: Montar mais só
  // aumenta anúncio existente, nunca cria (decisão do coordenador; o alvo `criar` é exclusivo da criação).
  const codigos = [...new Set(itens.flatMap((i) => [i.codigo, ...porCodigo.get(i.codigo)!.componentes.map((c) => c.codigo)]))].sort();
  const alvos = await deps.alvosDe(codigos);
  const comAlvo = new Set(alvos.map((a) => a.codigo));
  const faltando = codigos.filter((c) => !comAlvo.has(c));
  if (faltando.length > 0) {
    return recusa('sku_sem_anuncio', `Sem anúncio no Mercado Livre: ${faltando.join(', ')}. Montar mais só aumenta anúncio existente.`);
  }

  // Desmontar com reposição ligada desliga a reposição ANTES, para a automação não remontar (spec, Gerenciar).
  const desligarReposicao = input.acao === 'desmontar' && kit.reposicaoAuto;
  if (desligarReposicao && !(await cas({ reposicaoAuto: false }))) return recusa('versao', MSG_VERSAO);

  const r = await deps.criarTransferencia({
    orgId: deps.orgId, kitId: kit.id, tipo: input.acao as 'montar' | 'desmontar', itens,
    alvos: alvos.sort((a, b) => a.codigo.localeCompare(b.codigo))
      .map((a) => ({ codigo: a.codigo, upId: a.up_id, itemIds: a.item_ids })),
  });
  if (!('id' in r)) {
    return recusa(r.motivo, r.motivo === 'up_ocupado'
      ? 'Uma peça deste kit está em outra transferência. Tente de novo em alguns minutos.' : undefined);
  }
  await deps.enfileirarSaga(r.id);
  return { ok: true, transferenciaId: r.id, reposicaoDesligada: desligarReposicao, soEmKit: kit.soEmKit };
}
