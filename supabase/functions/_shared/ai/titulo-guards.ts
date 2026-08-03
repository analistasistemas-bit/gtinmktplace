import { extrairContagem, extrairLargura, extrairMetragem } from './titulo.ts';
import { LOJA_NUNCA_MARCA, marcaDoFornecedor } from './titulo-marcas.ts';
import { ORDEM_LEITURA, type SlotTitulo, type TituloSlots } from './titulo-slots.ts';

export interface DadosFonteTitulo {
  nomePai: string;
  descricaoPai: string;
  /** tipo_produto_busca já validado por validarTipoProdutoBusca (ADR-0054). */
  tipoProdutoBusca: string;
  /** Cores REAIS da família (sem 'Outra' nem placeholder de cor não identificada). */
  cores: string[];
  fornecedor: string | null;
}

function normalizar(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// T4 — o comprador não busca por abreviação de estoque.
const ABREVIACOES: Array<[RegExp, string]> = [
  [/\bC\/(?=[A-ZÁ-Ú])/gi, 'COM '],
  [/\bS\/(?=[A-ZÁ-Ú])/gi, 'SEM '],
  [/\bP\/(?=[A-ZÁ-Ú])/gi, 'PARA '],
  [/\bNIQ\b/gi, 'NIQUELADO'],
  [/\bAG\b/gi, 'AGULHA'],
  [/\bHEXAG\b/gi, 'HEXAGONAL'],
  [/\bESP\./gi, 'ESPECIAL '],
  [/\bBCO\b/gi, 'BRANCO'],
  [/\bDESL\b/gi, 'DESLIZE'],
];

// T4/T5 — ruído de planilha e código interno, descartados inteiros (não traduzidos).
const RUIDO = [
  /^TAM\s*(UND|VR|VAR)?$/i,   // "TAM UND", "TAM VR", "TAM"
  /^C\s*VAR$/i,
  /^CORES?$/i,                 // "CORES" indicando só que há variação
  /^[A-Z]{1,4}-\d{2,3}(-[A-Z]{1,3})?$/i, // T-007, BAR-03-VR
  /^REF\.?\s*\d+$/i,           // REF.275
  /^GRD\s*\d+$/i,              // GRD 7
];

// Dimensão composta: 10X15CM, 10 x 12, 3,00 X 1,80, 12X3.1X5CM. Unidade opcional no fim.
// Flag `i` porque a planilha grava a unidade em CAIXA ALTA ("10X15CM"); sem ela a unidade
// ficava de fora e a dimensão saía mutilada ("10X15").
// O `\b` depois da unidade impede que o "M" de "3,00 X 1,80 Metros" seja lido como unidade e
// vire um "M" solto pendurado no fim da medida.
const RE_DIMENSAO_COMPOSTA = /\d+(?:[.,]\d+)?\s*[xX]\s*\d+(?:[.,]\d+)?(?:\s*[xX]\s*\d+(?:[.,]\d+)?)*(?:\s*(?:mm|cm|m)\b)?/i;

/** Passo 2 do pipeline: higieniza e canonicaliza o que a IA devolveu. */
export function normalizarSlots(slots: TituloSlots): TituloSlots {
  const out = { ...slots };
  for (const slot of ORDEM_LEITURA) {
    let v = (out[slot] ?? '').trim().replace(/\s{2,}/g, ' ');
    // T2: separador e caractere decorativo nunca chegam ao título. A instrução no prompt não
    // basta — o formato antigo "proibia" adjetivo vazio e ele saía em 35% dos anúncios.
    v = v.replace(/[|★•·]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    for (const [re, sub] of ABREVIACOES) v = v.replace(re, sub);
    v = v.replace(/\s{2,}/g, ' ').trim();
    if (RUIDO.some((re) => re.test(v))) v = '';
    out[slot] = v;
  }
  return out;
}

function jaContem(valor: string, agulha: string): boolean {
  return new RegExp(`\\b${agulha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(valor);
}

/**
 * Passo 3: crava os dados que a fonte garante e a IA costuma descartar sob o teto de 60 chars.
 * Opera sobre SLOTS, nunca sobre a string final — é o que impede injeção e corte de disputarem
 * a mesma ponta do texto.
 */
export function aplicarGuardsTitulo(slots: TituloSlots, fonte: DadosFonteTitulo): TituloSlots {
  const out = { ...slots };
  const textoFonte = `${fonte.nomePai}\n${fonte.descricaoPai}`;

  // Tipo de produto (ADR-0054): nome só de marca+especificação não diz o que o produto É.
  const tipo = fonte.tipoProdutoBusca?.trim();
  if (tipo) {
    const palavras = normalizar(tipo).split(/\s+/).filter((w) => w.length >= 3);
    const presente = palavras.some((w) => jaContem(normalizar(out.produto), w));
    if (palavras.length > 0 && !presente) out.produto = `${tipo.toUpperCase()} ${out.produto}`.trim();
  }

  // Dimensão composta (10X15CM, 3,00 X 1,80) não é capturada por extrairMetragem nem por
  // extrairLargura, e às vezes é o ÚNICO dado que distingue famílias irmãs — as quatro
  // SACO DE ORGANZA e o Tecido Helanca 3,00 X 1,80 do catálogo real. Ela SEMPRE entra na
  // frente. A versão anterior a condicionava a "a fonte ainda não cobriu", que a apagava
  // exatamente quando a IA acertava e trazia dimensão e metragem juntas.
  const metragem = extrairMetragem(fonte.nomePai);
  const largura = extrairLargura(textoFonte);
  if (metragem || largura) {
    const partes = [metragem, largura].filter(Boolean) as string[];
    const composta = out.medida.match(RE_DIMENSAO_COMPOSTA)?.[0]?.trim();
    // Não repetir o que a dimensão composta já expressa: em "3,00 X 1,80 Metros" a fonte
    // extrai "1,80m", que a composta já contém. Compara sem a unidade.
    const restantes = composta
      ? partes.filter((p) => !jaContem(composta, p.replace(/[a-z]+$/i, '')))
      : partes;
    out.medida = composta ? [composta, ...restantes].join(' ').trim() : partes.join(' ');
  }

  // Quantidade: costuma vir só na descrição ("pacote com 10 unidades").
  // Contagem 1 NÃO entra: "CONTÉM: 1 UNIDADE" é boilerplate da planilha (49 das 91 famílias
  // com contagem extraível, medido em produção), e "1 unidade" é a suposição padrão do
  // comprador — ocuparia caractere do título sem informar nada.
  const contagem = extrairContagem(textoFonte);
  const numero = contagem ? Number(contagem.replace(/\D+/g, '')) : 0;
  if (contagem && numero > 1) out.quantidade = contagem;

  // Cor única → discriminador da família (anti-duplicado do ML, ADR-0044). Multi-cor não entra:
  // o comprador escolhe na variação, e afirmar uma cor induziria a erro.
  if (fonte.cores.length === 1) out.variacao = fonte.cores[0];
  else if (fonte.cores.length > 1) out.variacao = '';

  // Marca: o mapa só corrige a GRAFIA. A permissão vem de validarSlotsAncorados.
  const doMapa = marcaDoFornecedor(fonte.fornecedor);
  if (doMapa) out.marca = doMapa;

  return out;
}

/**
 * T3 — adjetivo sem dado. Lista fechada dos reincidentes medidos em produção (35% dos títulos
 * terminavam num deles). Proibidos em termos ABSOLUTOS, mesmo vindo da fonte: o sistema não
 * rastreia origem por campo — a fonte é um blob de texto —, então não há como distinguir um
 * atributo técnico declarado pelo fabricante de uma invenção do modelo.
 */
const ADJETIVOS_VAZIOS = [
  'elegante', 'versatil', 'resistente', 'super resistente', 'alta resistencia',
  'alta durabilidade', 'qualidade premium', 'alta qualidade', 'qualidade superior',
  'toque macio', 'macio', 'conforto e controle', 'secagem limpa', 'adesao firme',
  'alta aderencia', 'uso profissional', 'alta performance', 'excelente qualidade',
  'paleta vibrante', 'rolo economico', 'fixacao firme', 'premium', 'melhor',
  'imperdivel', 'promocao', 'oferta', 'pronta entrega', 'envio rapido', 'compre agora',
];

/** Passo 4: tudo que sobrevive precisa de respaldo na fonte. */
export function validarSlotsAncorados(slots: TituloSlots, fonte: DadosFonteTitulo): TituloSlots {
  const out = { ...slots };
  const alvoFonte = normalizar(`${fonte.nomePai} ${fonte.descricaoPai}`);

  // T3: adjetivo vazio sai de QUALQUER slot.
  for (const slot of ORDEM_LEITURA) {
    const v = normalizar(out[slot]).toLowerCase();
    if (v && ADJETIVOS_VAZIOS.includes(v)) out[slot] = '';
  }

  // Marca: o mapa deu a grafia, a fonte dá a permissão. Sem menção na fonte, a marca sai —
  // afirmá-la a partir do campo de fornecedor é o que o padrão do ML proíbe.
  if (out.marca) {
    const ehLoja = LOJA_NUNCA_MARCA.includes(normalizar(out.marca));
    const ancorada = alvoFonte.includes(normalizar(out.marca));
    if (ehLoja || !ancorada) out.marca = '';
  }

  // T7: sinônimo só quando presente na fonte. O modelo não pode inventar — "barbante" → "cordão"
  // e "linha" → "fio" trocam a identidade técnica do produto.
  if (out.sinonimo && !alvoFonte.includes(normalizar(out.sinonimo))) out.sinonimo = '';

  return out;
}
