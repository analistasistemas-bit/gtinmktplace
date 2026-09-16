// ADR-0078 F2: config de atacado POR FAIXA de preço. A config viaja na variação
// (coluna variacoes.atacado); NULL = herda o família-level.
// Divergência de preço + herança de config ATIVA sem confirmação explícita = LOUD (ADR-0055:
// nada financeiro defaulta em silêncio).
import type { FaixaAtacado } from '../canais/contrato.ts';

export interface ConfigFamiliaNivel {
  atacado: unknown;
}
export interface ConfigVariacaoNivel {
  codigo: string;
  atacado: unknown;
}
export interface ConfigGrupo {
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
  const famFaixas = comoFaixas(familia.atacado) ?? [];

  const efetivos = variacoesDoGrupo.map((v) => {
    const explicitoAtacado = comoFaixas(v.atacado) != null;
    return {
      codigo: v.codigo,
      explicitoAtacado,
      faixas: comoFaixas(v.atacado) ?? famFaixas,
    };
  });

  const chaves = new Set(efetivos.map((e) => chaveFaixas(e.faixas)));
  if (chaves.size > 1) {
    loud(
      `Config de atacado divergente dentro da mesma faixa de preço ` +
      `(${efetivos.map((e) => e.codigo).join(', ')}) — reconfigure a faixa na Revisão (400)`,
    );
  }

  if (familiaDivergente) {
    const herdaAtacadoAtivo = famFaixas.length > 0 && efetivos.some((e) => !e.explicitoAtacado);
    if (herdaAtacadoAtivo) {
      loud(
        'Família com preços divergentes: confirme atacado POR FAIXA na Revisão antes de ' +
        'publicar — a config família-level não se aplica a faixas em silêncio (ADR-0055) (400)',
      );
    }
  }

  const cfg = efetivos[0];
  return {
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
