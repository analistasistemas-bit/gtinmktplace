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

/** Passo 2 do pipeline: higieniza e canonicaliza o que a IA devolveu. */
export function normalizarSlots(slots: TituloSlots): TituloSlots {
  const out = { ...slots };
  for (const slot of ORDEM_LEITURA) {
    let v = (out[slot] ?? '').trim().replace(/\s{2,}/g, ' ');
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

  // Metragem: SEMPRE reescreve a partir da fonte. A IA arredonda ("13,7m" para "13,71m" real) e
  // às vezes duplica — checar "já contém a certa?" não pega a errada que ficou junto.
  //
  // ATENÇÃO ao alcance desta garantia: ela cobre metragem e largura, e SÓ. Dimensões compostas
  // ("10X12CM" nos sacos de organza) não casam com nenhum dos dois regex — se a IA as omitir,
  // nada as repõe, e quatro famílias irmãs viram títulos idênticos. Não é regressão (o código
  // antigo tinha o mesmo furo) e não vamos alargar o escopo aqui, mas é por isso que a métrica
  // de COLISÕES é o critério de aceite que carrega o peso, não um extra.
  //
  // A reescrita preserva o que a IA pôs em `medida` quando a fonte não tem nem metragem nem
  // largura — sem isso, um produto com dimensão no slot e um "LARGURA:" solto na descrição
  // perderia a dimensão inteira.
  const metragem = extrairMetragem(fonte.nomePai);
  const largura = extrairLargura(textoFonte);
  if (metragem || largura) {
    const partes = [metragem, largura].filter(Boolean) as string[];
    const dimensaoDaIa = out.medida.trim();
    const coberta = partes.some((p) => jaContem(dimensaoDaIa, p));
    // Dimensão que a IA trouxe e a fonte não sabe reproduzir entra na frente, não é descartada.
    out.medida = dimensaoDaIa && !coberta && /\d+\s*[xX]\s*\d+/.test(dimensaoDaIa)
      ? `${dimensaoDaIa} ${partes.join(' ')}`.trim()
      : partes.join(' ');
  }

  // Quantidade: costuma vir só na descrição ("pacote com 10 unidades").
  const contagem = extrairContagem(textoFonte);
  if (contagem) out.quantidade = contagem;

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
