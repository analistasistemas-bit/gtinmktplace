// ADR-0078 F2: config de desconto/atacado POR FAIXA de preço. A config viaja na variação
// (colunas variacoes.exibir_com_desconto/desconto_pct/atacado); NULL = herda o família-level.
// Divergência de preço + herança de config ATIVA sem confirmação explícita = LOUD (ADR-0055:
// nada financeiro defaulta em silêncio).
import type { FaixaAtacado } from '../canais/contrato.ts';

export interface ConfigFamiliaNivel {
  exibir_com_desconto: boolean | null;
  desconto_pct: number | string | null;
  atacado: unknown;
}
export interface ConfigVariacaoNivel {
  codigo: string;
  exibir_com_desconto: boolean | null;
  desconto_pct: number | string | null;
  atacado: unknown;
}
export interface ConfigGrupo {
  exibirComDesconto: boolean;
  descontoPct: number | null;
  faixasAtacado: FaixaAtacado[];
}

function comoFaixas(x: unknown): FaixaAtacado[] | null {
  return Array.isArray(x) ? (x as FaixaAtacado[]) : null; // null = "não configurado" (≠ [])
}
const chaveFaixas = (f: FaixaAtacado[]) =>
  JSON.stringify([...f].sort((a, b) => a.min_unidades - b.min_unidades));

function loud(msg: string): never {
  const e = new Error(msg) as Error & { status?: number };
  e.status = 400; // definitivo: retry do QStash não conserta config errada
  throw e;
}

export function resolverConfigGrupo(
  familia: ConfigFamiliaNivel,
  variacoesDoGrupo: ConfigVariacaoNivel[],
  familiaDivergente: boolean,
): ConfigGrupo {
  const famExibir = familia.exibir_com_desconto ?? false;
  const famPct = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
  const famFaixas = comoFaixas(familia.atacado) ?? [];

  const efetivos = variacoesDoGrupo.map((v) => {
    const explicitoDesconto = v.exibir_com_desconto != null;
    const explicitoAtacado = comoFaixas(v.atacado) != null;
    return {
      codigo: v.codigo,
      explicitoDesconto,
      explicitoAtacado,
      exibir: v.exibir_com_desconto ?? famExibir,
      pct: explicitoDesconto ? (v.desconto_pct != null ? Number(v.desconto_pct) : null) : famPct,
      faixas: comoFaixas(v.atacado) ?? famFaixas,
    };
  });

  const chaves = new Set(efetivos.map((e) => `${e.exibir}:${e.pct}:${chaveFaixas(e.faixas)}`));
  if (chaves.size > 1) {
    loud(
      `Config de desconto/atacado divergente dentro da mesma faixa de preço ` +
      `(${efetivos.map((e) => e.codigo).join(', ')}) — reconfigure a faixa na Revisão (400)`,
    );
  }

  if (familiaDivergente) {
    const herdaDescontoAtivo = famExibir && efetivos.some((e) => !e.explicitoDesconto);
    const herdaAtacadoAtivo = famFaixas.length > 0 && efetivos.some((e) => !e.explicitoAtacado);
    if (herdaDescontoAtivo || herdaAtacadoAtivo) {
      loud(
        'Família com preços divergentes: confirme desconto/atacado POR FAIXA na Revisão antes de ' +
        'publicar — a config família-level não se aplica a faixas em silêncio (ADR-0055) (400)',
      );
    }
  }

  const cfg = efetivos[0];
  return {
    exibirComDesconto: cfg?.exibir ?? false,
    descontoPct: cfg?.pct ?? null,
    faixasAtacado: cfg?.faixas ?? [],
  };
}

/** familias.atacado_status vira o agregado das partições (algum erro > algum aplicado > nada). */
export function agregarAtacadoStatus(
  porParticao: Array<{ status: 'aplicado' | 'erro' | null; erro: string | null }>,
): { atacado_status: 'aplicado' | 'erro' | null; atacado_erro: string | null } {
  const erro = porParticao.find((p) => p.status === 'erro');
  if (erro) return { atacado_status: 'erro', atacado_erro: erro.erro };
  if (porParticao.some((p) => p.status === 'aplicado')) {
    return { atacado_status: 'aplicado', atacado_erro: null };
  }
  return { atacado_status: null, atacado_erro: null };
}
