/**
 * Classificação heurística da causa provável de um descarte de validarSlotsAncorados
 * (titulo-guards.ts). Função pura, sem I/O — vive em scripts/ porque só o censo a usa (mesmo
 * espírito de scripts/experimento-titulo/metricas.ts).
 *
 * Reproduz, na mesma ORDEM do guard real, os motivos de descarte que o código expõe:
 *   1. token de marketing removido (removerMarketingNaoAncorado, por TOKEN, qualquer slot)
 *   2. adjetivo vazio — slot inteiro zerado (ADJETIVOS_VAZIOS, comparação exata)
 *   3. marca (só slot `marca`) — subdividida em DUAS causas distintas, porque
 *      aplicarGuardsTitulo SOBRESCREVE out.marca com marcaDoFornecedor(fornecedor) sempre que o
 *      fornecedor está mapeado, não importa o que a IA tenha devolvido no slot. Quando isso
 *      acontece, o descarte seguinte em validarSlotsAncorados não é a IA contrabandeando marca —
 *      é o próprio guard injetando um valor que a fonte não ancora, e o guard seguinte removendo
 *      de novo. Sem essa distinção o censo acusaria a IA por um valor que ela nunca escreveu
 *      (achado do revisor, medido em produção: Detallia é fornecedor mapeado, e as 15/20
 *      primeiras famílias descartadas na amostra piloto eram exatamente essa injeção-e-remoção).
 *   4. sinônimo não ancorado — T7 (só slot `sinonimo`)
 *
 * ADJETIVOS_VAZIOS e MARKETING_TERMOS são cópias literais das listas privadas (não exportadas)
 * de titulo-guards.ts — o número real de descartes (ANTES/DEPOIS) vem da função de produção, não
 * daqui; esta classificação é só um rótulo de leitura. Se a causa não bater em nenhuma delas,
 * cai em 'outro/nao classificado' — nunca adivinha.
 */
import { marcaDoFornecedor } from '../../supabase/functions/_shared/ai/titulo-marcas.ts';

function semAcento(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizarToken(w: string): string {
  return semAcento(w).toLowerCase().replace(/[^a-z]/g, '');
}

// Cópia de titulo-guards.ts:ADJETIVOS_VAZIOS (privada lá).
const ADJETIVOS_VAZIOS = [
  'elegante', 'versatil', 'resistente', 'super resistente', 'alta resistencia',
  'alta durabilidade', 'qualidade premium', 'alta qualidade', 'qualidade superior',
  'toque macio', 'macio', 'conforto e controle', 'secagem limpa', 'adesao firme',
  'alta aderencia', 'uso profissional', 'alta performance', 'excelente qualidade',
  'paleta vibrante', 'rolo economico', 'fixacao firme', 'premium', 'melhor',
  'imperdivel', 'promocao', 'oferta', 'pronta entrega', 'envio rapido', 'compre agora',
];

// Cópia de titulo-guards.ts:MARKETING_TERMOS (privada lá).
const MARKETING_TERMOS = new Set([
  'novo', 'nova', 'novos', 'novas', 'lancamento', 'inedito', 'exclusivo', 'exclusiva',
  'original', 'originais', 'premium', 'importado', 'importada', 'imperdivel',
]);

export type CausaDescarte =
  | 'token de marketing removido'
  | 'adjetivo vazio (slot zerado inteiro)'
  | 'marca injetada pelo guard a partir do fornecedor, nao ancorada na fonte'
  | 'marca da IA nao ancorada/loja'
  | 'sinonimo nao ancorado (T7)'
  | 'outro/nao classificado';

/**
 * `slot` é SlotTitulo tipado como string pra não puxar titulo-slots.ts só por causa do tipo.
 * `textoFonte` é `${nomePai} ${descricaoPai}`, cru — mesmo texto que removerMarketingNaoAncorado
 * tokeniza em produção. `fornecedor` é o mesmo campo de DadosFonteTitulo, usado só para replicar
 * a checagem de marcaDoFornecedor que decide a subcausa de marca (ver nota do cabeçalho).
 */
export function classificarDescarte(
  slot: string,
  antes: string,
  depois: string,
  textoFonte: string,
  fornecedor: string | null,
): CausaDescarte {
  const tokensFonte = new Set(textoFonte.split(/\s+/).filter(Boolean).map(normalizarToken));
  const teveMarketingRemovido = antes
    .split(/\s+/)
    .filter(Boolean)
    .some((w) => MARKETING_TERMOS.has(normalizarToken(w)) && !tokensFonte.has(normalizarToken(w)));
  if (teveMarketingRemovido) return 'token de marketing removido';

  if (depois === '' && ADJETIVOS_VAZIOS.includes(semAcento(antes).toLowerCase())) {
    return 'adjetivo vazio (slot zerado inteiro)';
  }

  if (slot === 'marca' && depois === '') {
    return marcaDoFornecedor(fornecedor) != null
      ? 'marca injetada pelo guard a partir do fornecedor, nao ancorada na fonte'
      : 'marca da IA nao ancorada/loja';
  }
  if (slot === 'sinonimo' && depois === '') return 'sinonimo nao ancorado (T7)';

  return 'outro/nao classificado';
}
