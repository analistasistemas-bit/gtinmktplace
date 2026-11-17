// DTOs da tela de Reposição (ADR-0207). Sem `jsr:`: o front importa daqui (o `tsc` do app não
// resolve `jsr:`, ver `_shared/galeria/modelos.ts`).
import type { ResultadoReposicao } from './calculo.ts';

export type StatusPedido = 'rascunho' | 'aprovado' | 'enviado' | 'parcial' | 'recebido' | 'saldo_encerrado';

export interface SkuTela {
  codigo: string; codigoPai: string; cor: string | null; corHex: string | null; tamanho: string | null;
  custo: number | null; preco: number | null; naoReporId: string | null;
}

export interface FamiliaTela {
  codigoPai: string; nome: string; fornecedor: { id: string | null; nome: string }; multiplo: number;
}

export interface NaoReporDTO {
  id: string; escopo: 'sku' | 'cor' | 'familia'; codigoPai: string; codigo: string | null; cor: string | null;
}

export interface PedidoItemDTO {
  codigo: string; codigoPai: string; quantidade: number; sugerida: number | null; recebida: number;
  encerrado: boolean; codigoFornecedor: string | null;
}

/** `salvoPor`, `aprovadoPor` e `alteradoPor` saem da edge como NOME do usuário (id no `dados.ts`). */
export interface PedidoDTO {
  id: string;
  fornecedor: { id: string; nome: string; cnpj: string | null };
  status: StatusPedido;
  previstoPara: string | null;
  /** status em enviado/parcial e `previstoPara` < hoje. */
  atrasado: boolean;
  salvoPor: string | null; salvoEm: string | null;
  aprovadoPor: string | null;
  enviadoEm: string | null;
  alteradoPor: string | null; alteradoEm: string | null;
  itens: PedidoItemDTO[];
}

/** Resposta do GET /reposicao. Sem configuração: `config` e `resultado` null e listas vazias. */
export interface RespostaReposicao {
  config: { prazo: number; cobertura: number } | null;
  resultado: ResultadoReposicao | null;
  skus: SkuTela[];
  familias: FamiliaTela[];
  naoRepor: NaoReporDTO[];
  rascunhos: PedidoDTO[];
  pedidos: PedidoDTO[];
}
