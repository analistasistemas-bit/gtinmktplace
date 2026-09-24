import { normalizarParaBusca } from './texto';

export interface OpcaoSku {
  codigo: string;
  rotulo: string;
  codigoPai: string;
  estoque: number;
  /** Campo pré-normalizado para busca rápida em grandes volumes de SKUs */
  textoBusca?: string;
}

export interface SkuEntradaCru {
  codigo: string;
  nome: string;
  cor?: string | null;
  /** ADR-0166: presente só em SKU de grade. */
  tamanho?: string | null;
  codigoPai: string;
  estoque: number;
}

/**
 * Constrói uma OpcaoSku pré-calculando o rótulo e o texto de busca normalizado.
 * O Diego possui organizações com mais de 8.000 SKUs; pré-normalizar evita
 * recalcular NFD e expressões regulares a cada tecla digitada no picker.
 */
export function montarOpcaoSku(s: SkuEntradaCru): OpcaoSku {
  const complemento = s.cor ? ` (${s.cor})` : '';
  const sufixoTamanho = s.tamanho?.trim() ? ` · ${s.tamanho.trim()}` : '';
  const rotulo = `${s.codigo} · ${s.nome}${complemento}${sufixoTamanho}`;
  const textoBusca = normalizarParaBusca(`${rotulo} ${s.codigoPai}`);

  return {
    codigo: s.codigo,
    rotulo,
    codigoPai: s.codigoPai,
    estoque: s.estoque,
    textoBusca,
  };
}

export function montarOpcoesSku(skus: SkuEntradaCru[]): OpcaoSku[] {
  return skus.map(montarOpcaoSku);
}

/**
 * Filtra opções de SKU de forma insensível a acentos e maiúsculas/minúsculas.
 */
export function filtrarOpcoesSku(opcoes: OpcaoSku[], busca: string, limite = 50): OpcaoSku[] {
  const termo = normalizarParaBusca(busca);
  if (!termo) return opcoes.slice(0, limite);

  return opcoes.filter((o) => {
    const texto = o.textoBusca ?? normalizarParaBusca(`${o.rotulo} ${o.codigoPai}`);
    return texto.includes(termo);
  }).slice(0, limite);
}
