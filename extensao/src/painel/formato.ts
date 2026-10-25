// Tipos e textos do painel (ADR-0189). Sem React: compartilhado pelos componentes.
import type { EntradaAnuncio, RespostaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';
import { MENSAGEM_LIMITE } from '../../../supabase/functions/_shared/extensao/erros.ts';
import type { RespostaExtensao } from '../api';
import type { DadosQualidade } from '../compartilhado/qualidade';

export type { EntradaAnuncio, RespostaAnuncio };
export type Resposta<T> = RespostaExtensao<T>;
/** Chamada à edge via SW (`publiai:chamar`). */
export type Chamar = <T>(corpo: object) => Promise<Resposta<T>>;
/** Estado da extensão (SW `publiai:estado-extensao`); `geracao` acompanha todo comando do painel. */
export interface EstadoExt {
  ativa: boolean;
  logado: boolean;
  perfil: { nome: string | null; orgNome: string | null } | null;
  versao: string;
  geracao: number;
}
/** Resposta de comando que devolve o estado novo (`entrar`, `sair`, `definir-ativa`). */
export type RespostaEstado = { ok: boolean; erro?: string } & Partial<EstadoExt>;
/** Última análise do content script na aba (SW `publiai:estado-da-aba`). */
export interface EstadoAba {
  entrada: EntradaAnuncio;
  resposta: Resposta<RespostaAnuncio>;
  /** Faixas (página e anúncio) e data de criação lidas no navegador (não vão à edge). Ausente em estado antigo. */
  observado?: { vendidosTexto: string | null; vendidosAnuncio?: string | null; criadoEm: string | null; motivo?: string; lojaOficial?: { nome: string | null } | null; qualidade?: DadosQualidade | null; tipoAnuncio?: 'gold_pro' | 'gold_special' | null; precoPix?: number | null };
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** `R$ 147,24` (espaço comum no lugar do não separável do Intl). */
export const brl = (n: number) => BRL.format(n).replace(/\s/g, ' ');
export const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function mensagemDeErro(erro: string): string {
  switch (erro) {
    case 'sem_sessao':
    case 'sessao_expirada':
      return 'Abra o PubliAI e conecte a extensão';
    case 'modulo_desligado':
      return 'A extensão não está habilitada para sua empresa';
    case 'credenciais_invalidas':
      return 'E-mail ou senha incorretos.';
    case 'rede':
      return 'Sem conexão. Tente de novo.';
    case 'sem_acesso':
      return 'Seu usuário está inativo ou sem empresa no PubliAI.';
    case 'identidade_mudou':
      return 'A conta mudou. Confira os dados e tente de novo.';
    case 'inativa':
      return 'A extensão está desativada. Ative para analisar.';
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

/** Termômetro de reputação do ML (level_id) → texto e cor do ponto (Vendedor e Catálogo). */
export const REPUTACAO: Record<string, { texto: string; cor: string }> = {
  '5_green': { texto: 'Verde', cor: 'verde' },
  '4_light_green': { texto: 'Verde-claro', cor: 'verde' },
  '3_yellow': { texto: 'Amarela', cor: 'amarelo' },
  '2_orange': { texto: 'Laranja', cor: 'amarelo' },
  '1_red': { texto: 'Vermelha', cor: 'vermelho' },
};
