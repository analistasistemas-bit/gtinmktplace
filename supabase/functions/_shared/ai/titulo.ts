import { ehCorIndefinida } from '../cor/indefinida.ts';

const TITULO_MAX = 60;

// Captura metragem real do nome (ex.: "100MT", "10MT", "50 METROS", "30 M", "13,71MT").
// Jardas (J) e códigos sem unidade de metro NÃO contam. Decimal com vírgula (formato BR) é
// opcional no grupo — sem ele, "13,71MT" batia só a partir da vírgula ("71MT"), fabricando
// uma metragem que não existe no produto (bug lote #65: "13,7MT 71MT" no título, sem "71MT"
// em lugar nenhum da descrição).
const RE_METRAGEM = /(\d+(?:,\d+)?)\s*(MTS|MT|METROS|METRO|M)\b/i;
// Mesmo padrão, mas global — usada por garantirMetragemTitulo pra achar TODAS as menções de
// metragem já no título (certa, arredondada pela IA, ou duplicada pela própria IA entre
// segmentos), não só a 1ª.
const RE_METRAGEM_TOKEN = /\b\d+(?:,\d+)?\s*(?:MTS|MT|METROS|METRO|M)\b/gi;

function normalizarUnidade(raw: string): string {
  return /^MT/i.test(raw) ? 'MT' : 'M';
}

export function extrairMetragem(nome: string): string | null {
  const m = nome.match(RE_METRAGEM);
  if (!m) return null;
  return `${m[1]}${normalizarUnidade(m[2])}`;
}

// Menciona metragem em QUALQUER forma (token exato como "50MT" ou por extenso como "50 metros")
// — usada pra decidir se a descrição já cobriu o dado antes de cravar um bullet redundante.
export function contemMetragem(texto: string): boolean {
  return RE_METRAGEM.test(texto);
}

// Captura largura em mm OU cm do texto-fonte (ex.: "6MM DE LARGURA", "LARGURA DE 6MM",
// "LARGURA: 6MM", "COM 5 CM DE LARGURA"). Exige a palavra LARGURA perto do número — nunca colide
// com RE_METRAGEM porque a unidade exigida aqui é MM/CM, não M/MT/METROS. Duas unidades porque a
// planilha mistura as duas por produto (achado real: franjas 5/8/10MM no nome_pai, mas a
// descrição do mesmo produto descreve a largura em CM — inconsistência da própria planilha,
// não corrigida aqui, só capturada nas duas formas).
const RE_LARGURA = /(\d+(?:,\d+)?)\s*(MM|CM)\s+DE\s+LARGURA\b|LARGURA\s*:?\s*(?:DE\s*)?(\d+(?:,\d+)?)\s*(MM|CM)\b/i;

export function extrairLargura(texto: string): string | null {
  const m = texto.match(RE_LARGURA);
  if (!m) return null;
  const numero = m[1] ?? m[3];
  const unidade = (m[2] ?? m[4]).toLowerCase();
  return `${numero}${unidade}`;
}

// Conectivos/preposições que, sozinhos no fim do título, denunciam frase cortada
// (a IA estoura o teto de 60 chars do schema no meio do "diferencial" → "VERSÁTIL E").
const CAUDA_CONECTIVA = new Set([
  'E', 'OU', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'COM', 'SEM', 'PARA', 'POR',
  'EM', 'NO', 'NA', 'A', 'O', 'AO', '&',
]);

// Remove a cauda incompleta do título: pipe pendurado (segmento vazio) e
// conectivos soltos no fim. Não toca em título já completo.
export function removerCaudaConectiva(titulo: string): string {
  let t = titulo.trim();
  for (;;) {
    const antes = t;
    t = t.replace(/\s*\|\s*$/, '').trimEnd(); // pipe pendurado / segmento vazio
    const palavras = t.split(/\s+/);
    const ultima = palavras[palavras.length - 1]?.toUpperCase();
    if (ultima && CAUDA_CONECTIVA.has(ultima)) {
      palavras.pop();
      t = palavras.join(' ').trimEnd();
    }
    if (t === antes) break; // estabilizou
  }
  return t;
}

// Enforça o teto de 60 chars SEM cortar palavra no meio. O schema do copywriter
// não tem mais maxLength (ele cortava mecanicamente, gerando "IDEAL PARA P" — bug
// do lote #26); a IA devolve o título inteiro e o limite vira responsabilidade aqui.
// Derruba primeiro segmentos inteiros (após " | "), depois palavras inteiras.
export function clampTitulo(titulo: string): string {
  let t = removerCaudaConectiva(titulo);
  if (t.length <= TITULO_MAX) return t;

  const partes = t.split(' | ');
  while (partes.length > 1 && partes.join(' | ').length > TITULO_MAX) {
    partes.pop();
  }
  t = partes.join(' | ');

  if (t.length > TITULO_MAX) {
    const palavras = t.split(/\s+/);
    while (palavras.length > 1 && palavras.join(' ').length > TITULO_MAX) {
      palavras.pop();
    }
    t = palavras.join(' ');
  }

  // Degenerado: um único "token" maior que 60 (sem espaço para derrubar) → corte duro.
  if (t.length > TITULO_MAX) t = t.slice(0, TITULO_MAX).trimEnd();

  return removerCaudaConectiva(t);
}

// Junta os segmentos (" | ") de volta, descartando os que a remoção de token deixou vazios
// (ex.: um segmento que só continha a metragem removida) — sem isso sobra "| |" ou "X | ".
function normalizarSegmentos(titulo: string): string {
  return titulo.split(' | ').map((s) => s.trim()).filter(Boolean).join(' | ');
}

// Garante que a metragem do nome apareça no título (dado crucial que diferencia
// produtos — ex.: fita 10MT vs 100MT), com exatamente UM valor: o real. Rede de segurança
// determinística porque a IA, sob o teto de 60 chars, descarta a metragem mesmo presente no
// nome — e o oposto também acontece: a IA inventa/arredonda uma metragem PRÓPRIA (ex. "13,7MT"
// pra "13,71MT" real) ou até duplica a mesma metragem em dois segmentos do título. Por isso
// SEMPRE remove toda menção de metragem já existente (RE_METRAGEM_TOKEN) antes de reanexar a
// certa — checar só "já contém a metragem certa?" e pular quando sim (versão anterior) não
// pega o caso em que a IA também deixou uma metragem ERRADA junto da certa (bug lote #65:
// "13,71MT BRANCO | 13,7MT" — a certa já estava lá, mas duplicada com uma arredondada).
export function garantirMetragemTitulo(titulo: string, nomePai: string): string {
  // Primeiro limpa a cauda incompleta deixada pelo corte de 60 chars da IA, para
  // o resultado (inclusive quando não há metragem no nome) nunca ter conectivo solto.
  titulo = removerCaudaConectiva(titulo);
  const metragem = extrairMetragem(nomePai);
  // Sem metragem: ainda assim clampa para 60 sem cortar palavra (cola, lote #26).
  if (!metragem) return clampTitulo(titulo);

  const semMetragem = removerCaudaConectiva(
    normalizarSegmentos(titulo.replace(RE_METRAGEM_TOKEN, ' ').replace(/\s{2,}/g, ' ')),
  );

  const sufixo = ` ${metragem}`;
  const partes = semMetragem.length > 0 ? semMetragem.split(' | ') : [''];
  partes[0] = `${partes[0]}${sufixo}`.trim();
  let candidato = partes.join(' | ');
  // Para caber em 60, derruba o "diferencial" genérico antes de aparar.
  while (candidato.length > TITULO_MAX && partes.length > 1) {
    partes.pop();
    candidato = partes.join(' | ');
  }
  // Sobrou só um segmento ainda longo: apara o texto-base preservando a metragem.
  if (candidato.length > TITULO_MAX) {
    const overflow = candidato.length - TITULO_MAX;
    const base = partes[0].slice(0, partes[0].length - sufixo.length);
    partes[0] = base.slice(0, Math.max(0, base.length - overflow)).trimEnd() + sufixo;
    candidato = partes.join(' | ');
  }
  return candidato;
}

// Adjetivos de marketing que a IA (gpt-4o-mini) às vezes inventa no título mesmo com a regra
// anti-alucinação no prompt — o prompt não GARANTE (bug real do lote #28: "NOVO NOVELO ANNE
// 500MT..." onde "NOVO" não existia na planilha nem na descrição). Guard determinístico: some
// só quando o termo é grounded (aparece como token na fonte); senão remove.
const MARKETING_TERMOS = new Set([
  'novo', 'nova', 'novos', 'novas', 'lancamento', 'inedito', 'exclusivo', 'exclusiva',
  'original', 'originais', 'premium', 'importado', 'importada', 'imperdivel',
]);

// Normaliza um token para comparação: sem acento, minúsculo, só letras (ignora pontuação/números
// grudados, ex.: "100%" ou "NOVO,"). Comparação é sempre por TOKEN inteiro, nunca substring —
// não pode confundir "NOVO" com "NOVELO" (tokens distintos).
function normalizarToken(w: string): string {
  return w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

// Remove do título os adjetivos de marketing da lista fechada acima que NÃO estão presentes
// (como token) no texto-fonte (nome + descrição). Se o termo genuinamente consta na fonte,
// mantém. Puro/determinístico — não depende de IA. Reutiliza removerCaudaConectiva para limpar
// conectivos que a remoção deixe soltos no fim.
export function removerMarketingNaoGrounded(titulo: string, nome: string, descricao: string): string {
  const fonte = new Set(`${nome} ${descricao}`.split(/\s+/).filter(Boolean).map(normalizarToken));
  const palavras = titulo.split(/\s+/).filter(Boolean);
  const mantidas = palavras.filter((p) => {
    const norm = normalizarToken(p);
    return !MARKETING_TERMOS.has(norm) || fonte.has(norm);
  });
  const segmentos = mantidas.join(' ').split('|').map((s) => s.trim()).filter(Boolean);
  return removerCaudaConectiva(segmentos.join(' | '));
}

// Normaliza para a comparação "cor já está no título": sem acento, em CAPS.
function normalizarBusca(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Testa se TODAS as palavras de `termo` (multi-palavra) já aparecem como palavra inteira em
// qualquer lugar do título — não exige ordem nem adjacência. Ex.: cor "Verde 7" cobre
// "...RESINA 7 VERDE..." mesmo com "7" antes de "Verde" e por outro motivo no nome (lote #33).
function todasPalavrasCobertas(titulo: string, termo: string): boolean {
  const tituloNorm = normalizarBusca(titulo);
  const palavras = normalizarBusca(termo).split(/\s+/).filter(Boolean);
  return palavras.length > 0 && palavras.every((w) => new RegExp(`\\b${escaparRegex(w)}\\b`).test(tituloNorm));
}

// Fallback pra termo composto que a IA devolve colado (ex.: "pompom") enquanto o nome/título já
// usa a forma espaçada ("POM POM") — a checagem por palavra inteira não bate porque o espaço
// quebra a contiguidade. Remove espaços dos dois lados e testa contenção simples. Só entra em
// jogo quando a checagem por palavra falha (lote #33: "POMPOM POM POM..." duplicado).
function termoColadoNoTitulo(titulo: string, termo: string): boolean {
  const semEspacoTitulo = normalizarBusca(titulo).replace(/\s+/g, '');
  const semEspacoTermo = normalizarBusca(termo).replace(/\s+/g, '');
  return semEspacoTermo.length > 0 && semEspacoTitulo.includes(semEspacoTermo);
}

const MIN_PALAVRA_SIGNIFICATIVA_TITULO = 3;

// Garante que o TIPO DE PRODUTO apareça no título quando ele não está no nome_pai mas foi
// extraído (grounded) da descrição pelo copywriter (tipo_produto_busca, ADR-0054). Sem isso
// nomes só de marca+especificação (ex.: "EUROROMA 4/6 CORES 600G 610MT") geram título sem
// dizer o que o produto É (bug lote #50: título sem "BARBANTE"). Roda ANTES de
// garantirMetragemTitulo/garantirCorTitulo na composição (prefixo, não sufixo — o tipo de
// produto lidera o título, igual ao exemplo do prompt "FITA CETIM PROGRESSO...").
// Se não há palavra significativa (>=3 letras) pra verificar ausência com segurança, não
// mexe no título — prefixar às cegas arriscaria duplicar (ex.: "FIO FIO DE COSTURA 100M").
export function garantirTipoProdutoTitulo(titulo: string, tipoProdutoBusca: string): string {
  const tipo = tipoProdutoBusca?.trim();
  if (!tipo) return titulo;
  const palavrasTipo = normalizarBusca(tipo).split(/\s+/).filter((w) => w.length >= MIN_PALAVRA_SIGNIFICATIVA_TITULO);
  if (palavrasTipo.length === 0) return titulo;

  const tituloNorm = normalizarBusca(titulo);
  const jaPresente = palavrasTipo.some((w) => new RegExp(`\\b${w}\\b`).test(tituloNorm))
    || termoColadoNoTitulo(titulo, tipo);
  if (jaPresente) return titulo;

  let candidato = `${tipo.toUpperCase()} ${titulo}`;
  if (candidato.length <= TITULO_MAX) return candidato;

  const partes = candidato.split(' | ');
  while (partes.length > 1 && partes.join(' | ').length > TITULO_MAX) partes.pop();
  candidato = partes.join(' | ');
  if (candidato.length > TITULO_MAX) {
    const palavras = candidato.split(/\s+/);
    while (palavras.length > 1 && palavras.join(' ').length > TITULO_MAX) palavras.pop();
    candidato = palavras.join(' ');
  }
  return removerCaudaConectiva(candidato);
}

// Sinônimos concorrentes pra "tipo de fio/linha" que a descrição costuma usar pra falar do MESMO
// produto (ex.: "Linha Cléa 1000... o FIO Cléa é ideal..." — ambos grounded, então
// validarTipoProdutoBusca/garantirTipoProdutoTitulo aceitam qualquer um dos dois). Não usa
// tipo_aviamento (categoria ML) como sinal: o bucket "Fios e Cadarços" mistura barbante/fio/linha
// legítimos (ex.: BARBANTE EUROROMA, ADR-0054) — canonicalizar por ali reverteria essa cravação.
const SINONIMOS_TIPO_FIO = ['LINHA', 'FIO', 'BARBANTE'];

// A própria planilha (nome_pai, fonte de verdade do produto) às vezes já declara qual dos
// sinônimos é o certo: por extenso (ex.: "FIO NAUTICO", "BARBANTE ALGODAO") ou pela abreviação
// "L." (convenção observada no catálogo: L.CLEA/L.LIZA = "Linha Cléa"/"Linha Liza").
function tipoFioDeclaradoNoNome(nomePai: string): string | null {
  if (/^L\./i.test(nomePai.trim())) return 'LINHA';
  const m = nomePai.match(/\b(LINHA|FIO|BARBANTE)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// Corrige a 1ª palavra do título quando ela é um sinônimo de tipo de fio DIFERENTE do que
// nome_pai já declara (bug lote #63: "FIO CLÉA 1000..." quando a planilha diz "L.CLEA" = Linha
// Cléa). Sem sinal em nome_pai (ex.: EUROROMA, que não diz o que é), não mexe — conservador por
// construção, nunca inventa a partir de sinônimos só grounded na descrição. Roda DEPOIS de
// garantirTipoProdutoTitulo (senão a troca faz esse guard achar o tipo "ausente" e reprefixar) e
// ANTES de garantirMetragemTitulo/garantirCorTitulo (que ainda clampam o tamanho final em 60).
export function garantirTipoFioTitulo(titulo: string, nomePai: string): string {
  const declarado = tipoFioDeclaradoNoNome(nomePai);
  if (!declarado) return titulo;

  const palavras = titulo.split(/\s+/);
  const primeira = normalizarBusca(palavras[0] ?? '');
  if (primeira === declarado || !SINONIMOS_TIPO_FIO.includes(primeira)) return titulo;

  palavras[0] = declarado;
  return palavras.join(' ');
}

// Garante que a cor apareça no título quando o anúncio é de cor ÚNICA (mono-cor). Sem isso,
// duas famílias-irmãs que diferem só na cor (PAI separado na planilha) geram títulos idênticos
// e o ML baixa a segunda como duplicado ("Era igual a outro anúncio"). Rede de segurança
// determinística porque a IA, sob o teto de 60 chars e o prompt multi-cor, descarta a cor.
// Multi-cor (variação de cor real) NÃO leva cor no título — retorna o título intacto.
export function garantirCorTitulo(titulo: string, cor: string | null, nCores: number): string {
  if (nCores !== 1) return titulo;
  const corLimpa = cor?.trim() ?? '';
  if (ehCorIndefinida(corLimpa)) return titulo;

  // Já contém a cor (todas as palavras, em qualquer ordem/posição)? Não duplica.
  if (todasPalavrasCobertas(titulo, corLimpa)) return titulo;

  const sufixo = ` ${corLimpa.toUpperCase()}`;
  const partes = titulo.split(' | ');
  partes[0] = `${partes[0]}${sufixo}`;
  let candidato = partes.join(' | ');
  // Para caber em 60, derruba o "diferencial" genérico antes de aparar (igual à metragem).
  while (candidato.length > TITULO_MAX && partes.length > 1) {
    partes.pop();
    candidato = partes.join(' | ');
  }
  // Sobrou só um segmento ainda longo: apara o texto-base preservando a cor (dado diferenciador).
  if (candidato.length > TITULO_MAX) {
    const overflow = candidato.length - TITULO_MAX;
    const base = partes[0].slice(0, partes[0].length - sufixo.length);
    partes[0] = base.slice(0, Math.max(0, base.length - overflow)).trimEnd() + sufixo;
    candidato = partes.join(' | ');
  }
  return candidato;
}

// Garante que a largura (mm ou cm) apareça no título quando grounded (ex.: "6MM DE LARGURA" ou
// "5 CM DE LARGURA" na descrição) — mesma rede de segurança de
// garantirMetragemTitulo/garantirCorTitulo, mas pra largura, que costuma ficar só na descrição
// da planilha (não no nome_pai) e por isso a IA a descarta com mais frequência ainda. Roda
// depois de garantirMetragemTitulo (largura acompanha a metragem no mesmo segmento) e antes de
// garantirCorTitulo (que ainda clampa o tamanho final).
export function garantirLarguraTitulo(titulo: string, largura: string | null): string {
  if (!largura) return titulo;
  if (new RegExp(`\\b${escaparRegex(largura)}\\b`, 'i').test(titulo)) return titulo;

  const sufixo = ` ${largura.toUpperCase()}`;
  const partes = titulo.split(' | ');
  partes[0] = `${partes[0]}${sufixo}`.trim();
  let candidato = partes.join(' | ');
  while (candidato.length > TITULO_MAX && partes.length > 1) {
    partes.pop();
    candidato = partes.join(' | ');
  }
  if (candidato.length > TITULO_MAX) {
    const overflow = candidato.length - TITULO_MAX;
    const base = partes[0].slice(0, partes[0].length - sufixo.length);
    partes[0] = base.slice(0, Math.max(0, base.length - overflow)).trimEnd() + sufixo;
    candidato = partes.join(' | ');
  }
  return candidato;
}
