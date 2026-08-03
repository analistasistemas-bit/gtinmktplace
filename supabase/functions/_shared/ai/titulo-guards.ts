import { extrairContagem, extrairLargura, extrairMetragem } from './titulo.ts';
import { LOJA_NUNCA_MARCA, marcaDoFornecedor } from './titulo-marcas.ts';
import { ORDEM_LEITURA, type TituloSlots } from './titulo-slots.ts';
import { ehCorIndefinida } from '../cor/indefinida.ts';

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

// Termo cujas palavras já estão em outro slot não é recravado — duplicaria o dado no título
// ("Lapis de Escrever Resina 7 Verde ... Verde 7", lote #33). Não exige ordem nem adjacência:
// "Verde 7" está coberta por "RESINA 7 VERDE".
function todasPalavrasCobertas(texto: string, termo: string): boolean {
  const alvo = normalizar(texto);
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  return palavras.length > 0 && palavras.every((w) => jaContem(alvo, w));
}

// Fallback para termo composto que a IA devolve colado ("pompom") enquanto o nome já usa a
// forma espaçada ("POM POM") — a checagem por palavra inteira não bate porque o espaço quebra
// a contiguidade. Só entra em jogo quando a checagem por palavra falha (lote #33).
function termoColado(texto: string, termo: string): boolean {
  const semEspacoTexto = normalizar(texto).replace(/\s+/g, '');
  const semEspacoTermo = normalizar(termo).replace(/\s+/g, '');
  return semEspacoTermo.length > 0 && semEspacoTexto.includes(semEspacoTermo);
}

// Sinônimos concorrentes para "tipo de fio" que a descrição usa para o MESMO produto. Não usa
// tipo_aviamento (categoria ML) como sinal: o bucket "Fios e Cadarços" mistura barbante/fio/linha
// legítimos (ADR-0054).
const SINONIMOS_TIPO_FIO = ['LINHA', 'FIO', 'BARBANTE'];

// A planilha às vezes já declara qual sinônimo é o certo: por extenso ("FIO NAUTICO") ou pela
// abreviação "L." (convenção do catálogo: L.CLEA = "Linha Cléa").
function tipoFioDeclaradoNoNome(nomePai: string): string | null {
  if (/^L\./i.test(nomePai.trim())) return 'LINHA';
  const m = nomePai.match(/\b(LINHA|FIO|BARBANTE)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * ADR-0070: corrige a 1ª palavra de `produto` quando ela é um sinônimo de tipo de fio DIFERENTE
 * do que nome_pai declara (bug lote #63: "FIO CLÉA 1000" quando a planilha diz "L.CLEA").
 * Sem sinal em nome_pai não mexe — conservador por construção, nunca inventa a partir de
 * sinônimo só grounded na descrição.
 */
function corrigirTipoFio(produto: string, nomePai: string): string {
  const declarado = tipoFioDeclaradoNoNome(nomePai);
  if (!declarado) return produto;
  const palavras = produto.split(/\s+/);
  const primeira = normalizar(palavras[0] ?? '');
  if (primeira === declarado || !SINONIMOS_TIPO_FIO.includes(primeira)) return produto;
  palavras[0] = declarado;
  return palavras.join(' ');
}

// Só contagem canônica (10un, 12pc) com número > 1 sobrevive no slot `quantidade`.
// Devolve null para qualquer outra coisa — inclusive para o que a IA escreveu no slot errado.
function contagemValida(valor: string | null): string | null {
  const m = valor?.trim().match(/^(\d+)\s*(un|pc)$/i);
  if (!m) return null;
  return Number(m[1]) > 1 ? `${m[1]}${m[2].toLowerCase()}` : null;
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
    const presente = palavras.some((w) => jaContem(normalizar(out.produto), w))
      || termoColado(out.produto, tipo);
    if (palavras.length > 0 && !presente) out.produto = `${tipo.toUpperCase()} ${out.produto}`.trim();
  }

  // Tipo de fio (ADR-0070): roda DEPOIS do bloco acima de propósito — o bloco de tipo de
  // produto pode ter acabado de prefixar um sinônimo (ex.: "FIO DE CROCHÊ"), e é esse prefixo
  // que precisa ser corrigido também, não só o que a IA escreveu originalmente.
  out.produto = corrigirTipoFio(out.produto, fonte.nomePai);

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

  // Quantidade: costuma vir só na descrição ("pacote com 10 unidades"). A fonte vence a IA,
  // que erra o slot com frequência — observado em execução real: com a fonte
  // "FRANJA 5MM 100%FIBRA DE POLI 5MT" a IA pôs quantidade="5m" (metragem, não contagem) e o
  // título saiu com "5m" duas vezes.
  //
  // Contagem 1 NÃO entra, venha da fonte ou da IA: "CONTÉM: 1 UNIDADE" é boilerplate da
  // planilha (49 das 91 famílias com contagem extraível, medido em produção) e "1 unidade" é
  // a suposição padrão do comprador — ocuparia caractere do título sem informar nada.
  out.quantidade = contagemValida(extrairContagem(textoFonte)) ?? contagemValida(out.quantidade) ?? '';

  // Cor única → discriminador da família (anti-duplicado do ML, ADR-0044). Multi-cor não entra:
  // o comprador escolhe na variação, e afirmar uma cor induziria a erro.
  // 'Outra' (veredito do Vision quando não classifica a foto) e o placeholder de cor não
  // identificada NUNCA entram — incidente do lote #31, "OUTRA" publicado no título de um pote
  // de lápis. O guard antigo (garantirCorTitulo) tinha essa trava; ela precisa sobreviver aqui.
  const corUnica = fonte.cores.length === 1 ? fonte.cores[0] : null;
  // Cor cujas palavras já estão em outro slot (ex.: tipo_produto_busca prefixou "Resina 7
  // Verde" em `produto`) não é recravada em `variacao` — duplicaria o dado no título (lote
  // #33). Alvo é o texto dos demais slots JÁ preenchidos neste ponto do pipeline, nunca o
  // próprio `variacao`.
  const corJaCoberta = corUnica != null && todasPalavrasCobertas(
    ORDEM_LEITURA.filter((s) => s !== 'variacao').map((s) => out[s]).join(' '),
    corUnica,
  );
  if (corUnica && !ehCorIndefinida(corUnica) && !corJaCoberta) out.variacao = corUnica;
  else if (fonte.cores.length !== 1 || ehCorIndefinida(corUnica) || corJaCoberta) out.variacao = '';

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

// Adjetivos de marketing que a IA inventa mesmo com a regra no prompt — o prompt não GARANTE
// (bug real do lote #28: "NOVO NOVELO ANNE 500MT", com "NOVO" ausente da planilha). Diferente
// de ADJETIVOS_VAZIOS, que é proibição absoluta do slot inteiro, aqui a remoção é por TOKEN e
// condicional: o termo FICA quando genuinamente consta na fonte.
const MARKETING_TERMOS = new Set([
  'novo', 'nova', 'novos', 'novas', 'lancamento', 'inedito', 'exclusivo', 'exclusiva',
  'original', 'originais', 'premium', 'importado', 'importada', 'imperdivel',
]);

// Normaliza para comparação por token: sem acento, minúsculo, só letras (ignora pontuação e
// número grudados). Comparação é sempre por TOKEN inteiro, nunca substring — não pode confundir
// "NOVO" com "NOVELO".
function normalizarToken(w: string): string {
  return w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function removerMarketingNaoAncorado(valor: string, tokensFonte: Set<string>): string {
  return valor
    .split(/\s+/)
    .filter(Boolean)
    .filter((p) => {
      const n = normalizarToken(p);
      return !MARKETING_TERMOS.has(n) || tokensFonte.has(n);
    })
    .join(' ')
    .trim();
}

/** Passo 4: tudo que sobrevive precisa de respaldo na fonte. */
export function validarSlotsAncorados(slots: TituloSlots, fonte: DadosFonteTitulo): TituloSlots {
  const out = { ...slots };
  const alvoFonte = normalizar(`${fonte.nomePai} ${fonte.descricaoPai}`);

  // T-lote#28: marketing não-ancorado sai por TOKEN de qualquer slot (produto incluso — nada
  // ancorava o slot produto antes disso). Roda ANTES do T3 abaixo de propósito: um termo de
  // marketing pode ser o único sobrevivente de um slot depois de perder as outras palavras
  // ("Novo Premium" → "Premium"), e precisa ainda estar sujeito à proibição absoluta seguinte.
  const tokensFonte = new Set(
    `${fonte.nomePai} ${fonte.descricaoPai}`.split(/\s+/).filter(Boolean).map(normalizarToken),
  );
  for (const slot of ORDEM_LEITURA) {
    if (out[slot]) out[slot] = removerMarketingNaoAncorado(out[slot], tokensFonte);
  }

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
