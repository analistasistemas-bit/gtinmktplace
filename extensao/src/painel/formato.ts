// Tipos e textos do painel (ADR-0189). Sem React: compartilhado pelos componentes.
import type { EntradaAnuncio, RespostaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';
import { MENSAGEM_LIMITE } from '../../../supabase/functions/_shared/extensao/erros.ts';
import type { RespostaExtensao } from '../api';

export type { EntradaAnuncio, RespostaAnuncio };
export type Resposta<T> = RespostaExtensao<T>;
/** Chamada à edge via SW (`publiai:chamar`). */
export type Chamar = <T>(corpo: object) => Promise<Resposta<T>>;
/** Última análise do content script na aba (SW `publiai:estado-da-aba`). */
export interface EstadoAba {
  entrada: EntradaAnuncio;
  resposta: Resposta<RespostaAnuncio>;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** `R$ 147,24` (espaço comum no lugar do não separável do Intl). */
export const brl = (n: number) => BRL.format(n).replace(/\s/g, ' ');
export const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;

export function mensagemDeErro(erro: string): string {
  switch (erro) {
    case 'sem_sessao':
    case 'sessao_expirada':
      return 'Abra o PubliAI e conecte a extensão';
    case 'modulo_desligado':
      return 'A extensão não está habilitada para sua empresa';
    case 'sessao_suporte_expirada':
      return 'A sessão de suporte expirou. Abra o PubliAI e inicie uma nova sessão.';
    case 'limite':
      return MENSAGEM_LIMITE;
    default:
      return 'Não foi possível analisar este anúncio. Tente de novo.';
  }
}

export const ROTULO_FONTE: Record<string, string> = {
  catalogo: 'casado pelo catálogo',
  ean_da_busca: 'EAN da busca',
  vinculo_manual: 'vínculo manual',
};

export const URL_APP = import.meta.env.VITE_PUBLIAI_APP_URL || 'https://app.publiai.daludi.com.br/';
