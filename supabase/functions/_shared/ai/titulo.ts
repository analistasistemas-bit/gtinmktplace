import { ehCorIndefinida } from '../cor/indefinida.ts';

const TITULO_MAX = 60;

// Captura metragem real do nome (ex.: "100MT", "10MT", "50 METROS", "30 M", "13,71MT").
// Jardas (J) e códigos sem unidade de metro NÃO contam. Decimal com vírgula (formato BR) é
// opcional no grupo — sem ele, "13,71MT" batia só a partir da vírgula ("71MT"), fabricando
// uma metragem que não existe no produto (bug lote #65: "13,7MT 71MT" no título, sem "71MT"
// em lugar nenhum da descrição).
const RE_METRAGEM = /(\d+(?:,\d+)?)\s*(MTS|MT|METROS|METRO|M)\b/i;
// A unidade canônica do padrão ML é "m" minúsculo (ADR-0099): "570m", nunca "570mt".
// Esta função ANTES emitia 'MT'/'M' — era a origem dos 38% de títulos com "MT" medidos em
// produção. A DETECÇÃO continua aceitando MT/MTS/METROS/M na entrada; só a EMISSÃO mudou.
function normalizarUnidade(_raw: string): string {
  return 'm';
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

const RE_CONTAGEM = /\b(\d+)\s*(UNIDADES?|UNDS?|UND|UN|PEÇAS?|PECAS?|PÇS?|PCS?|PC)\b/i;

// Canônico: "10un" / "12pc" (ADR-0099). Antes emitia "10 UNIDADES", que gastava caractere e
// destoava do padrão ML. A detecção segue aceitando UNIDADES/UND/UN/PEÇAS/PÇS/PCS/PC.
export function extrairContagem(texto: string): string | null {
  const m = texto.match(RE_CONTAGEM);
  if (!m) return null;
  const unidade = /^(?:P|PC)/i.test(m[2]) ? 'pc' : 'un';
  return `${m[1]}${unidade}`;
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

// NOTA (Task 11, ADR-0070): `garantirTipoProdutoTitulo` e `garantirCorTitulo` abaixo (e seus
// helpers `todasPalavrasCobertas`/`termoColadoNoTitulo`/`normalizarBusca`/`escaparRegex`) NÃO são
// mais chamados pelo pipeline de slots (`aplicarGuardsTitulo`/`titulo-guards.ts`) — ficam
// intencionalmente aqui, não deletados. Cada um carrega uma trava anti-duplicação de incidente
// real do lote #33 (termo colado — "POMPOM POM POM..." — e cor multi-palavra fora de ordem —
// "...RESINA 7 VERDE...") que o pipeline novo ainda não reproduz: `aplicarGuardsTitulo` crava
// `variacao`/prefixa o tipo de produto sem checar se o dado já apareceu em outro slot (ex.:
// `produto`). Decisão de portar o fix ou aposentar os guards é do Diego (ver task-11-report.md).
// Garante que o TIPO DE PRODUTO apareça no título quando ele não está no nome_pai mas foi
// extraído (grounded) da descrição pelo copywriter (tipo_produto_busca, ADR-0054). Sem isso
// nomes só de marca+especificação (ex.: "EUROROMA 4/6 CORES 600G 610MT") geram título sem
// dizer o que o produto É (bug lote #50: título sem "BARBANTE"). Roda como prefixo, não sufixo
// — o tipo de produto lidera o título, igual ao exemplo do prompt "FITA CETIM PROGRESSO...".
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
