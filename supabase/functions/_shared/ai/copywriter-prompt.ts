import { ordenarCoresAlfabetica } from '../cor/ordenar.ts';
import { ehCorIndefinida } from '../cor/indefinida.ts';
import { rotuloQuantidade } from './unidade.ts';
import { contemMetragem, extrairLargura, extrairMetragem } from './titulo.ts';
import { ROTULO_COR, resolverEixoVariacao } from './eixo-variacao.ts';

export interface InputCopy {
  nome: string;
  descricao_detalhado: string;
  /**
   * `nome` alimenta o eixo de variação (ADR-0115) — sem ele a família cai no caminho de cor,
   * que é o comportamento anterior. Opcional de propósito: `titulo-particao.ts` monta variações
   * sintéticas que não têm nome de planilha.
   */
  variacoes: Array<{ codigo: string; cor: string | null; preco: number; nome?: string | null }>;
  unidade?: string | null;
  categoria_hint?: 'linhas' | 'botoes' | 'fitas';
}

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokens(s: string): string[] {
  return normalizar(s).split(/\s+/).filter(Boolean);
}

const MIN_PALAVRA_SIGNIFICATIVA = 3; // abaixo disso é preposição/artigo (de/e/a/o...), nunca conta

/**
 * Regra de ouro (mesmo espírito anti-invenção do ADR-0052, adaptado): só aceita
 * tipo_produto_busca se ALGUMA palavra dele (>=3 letras) constar literalmente em nome ou
 * descrição. Zero palavras significativas na frase → REJEITA (nunca aceita por padrão).
 * Diferente de validarTextoLivre (atributos-llm-core.ts): aqui é frase de BUSCA, pode
 * combinar o substantivo grounded com contexto de uso genérico já permitido no prompt
 * (ex.: "barbante de croche" quando só "barbante" está na fonte) — não é valor extraído.
 */
export function validarTipoProdutoBusca(tipoProdutoBusca: string, nome: string, descricao: string): string {
  const valor = tipoProdutoBusca?.trim() ?? '';
  if (!valor) return '';
  const fonte = new Set(tokens(`${nome} ${descricao}`));
  const palavrasRelevantes = tokens(valor).filter((w) => w.length >= MIN_PALAVRA_SIGNIFICATIVA);
  if (palavrasRelevantes.length === 0) return '';
  const grounded = palavrasRelevantes.some((w) => fonte.has(w));
  return grounded ? valor : '';
}

/**
 * Fórmulas de R3 (ADR-0098): afirmam prova social, autoridade ou intenção de projeto sem
 * respaldo na fonte. Esta função VERIFICA apenas — nunca edita. Remover a expressão por
 * substituição parcial quebraria a pontuação e a concordância da frase em volta ("A Linha
 * Búfalo, reconhecida por profissionais, oferece..." → vírgula órfã), e a lista tem falso
 * positivo legítimo: uma citação do fabricante pode conter "desenvolvida para". Quem decide
 * o que fazer com o achado é o harness do experimento hoje e o validador com regeneração
 * controlada na fase 2 — jamais um replace cego.
 */
const FORMULAS_PROIBIDAS = [
  'reconhecida por', 'reconhecido por',
  'preferida pelos profissionais', 'preferido pelos profissionais',
  'utilizada por', 'utilizado por',
  'desenvolvida para', 'desenvolvido para',
  'projetada para', 'projetado para',
  'pensada para', 'pensado para',
  'a melhor', 'o melhor', 'a mais', 'o mais',
  'ideal para producao intensa',
] as const;

export function detectarFormulasProibidas(texto: string): string[] {
  // normalizar já baixa a caixa e remove acento — o regex não precisa da flag i, e
  // 'producao intensa' na lista casa com 'produção intensa' no texto.
  const alvo = normalizar(texto ?? '');
  return FORMULAS_PROIBIDAS.filter((f) => new RegExp(`\\b${f}\\b`).test(alvo));
}

const SECAO_ESPECIFICACOES = '📌 ESPECIFICAÇÕES';
// Ordem do template (SYSTEM acima) a partir de ESPECIFICAÇÕES — usada só para achar onde a
// seção termina, caso ela exista, ou onde inserir uma nova, caso a IA tenha pulado a seção
// inteira (bug real: produto 02994771 saiu sem "📌 ESPECIFICAÇÕES" nenhuma).
// Casam pelo EMOJI, não pelo texto do cabeçalho (ADR-0115). O texto passou a variar — o rótulo
// da seção de variação depende do eixo da família, e BENEFÍCIOS/CONTEÚDO foram renomeados —, e
// casar por texto tornaria toda renomeação futura uma quebra silenciosa: o guard não acharia a
// fronteira da seção e injetaria o bullet depois do lugar certo. O emoji é a parte estável.
// Ele também está na whitelist do SYSTEM (bloco TOM E ESTILO): sem isso o modelo suprime o
// símbolo e nada mais casa aqui.
const CABECALHOS_APOS_ESPECIFICACOES = ['🎯', '❓', '🎨', '📦', '🚚'];

function inserirAntesDoProximoCabecalho(
  descricao: string,
  bloco: string,
  cabecalhos: string[] = CABECALHOS_APOS_ESPECIFICACOES,
): string {
  const posicoes = cabecalhos
    .map((h) => descricao.indexOf(h))
    .filter((i) => i > -1);
  const idx = posicoes.length > 0 ? Math.min(...posicoes) : descricao.length;
  return `${descricao.slice(0, idx).trimEnd()}\n\n${bloco}\n\n${descricao.slice(idx)}`.trim();
}

// Injeta um bullet em ESPECIFICAÇÕES, criando a seção (no lugar certo do template) se a IA a
// tiver pulado inteira — bug real: produto 02994771 saiu sem "📌 ESPECIFICAÇÕES" nenhuma.
// Chamadas em sequência (largura, depois metragem) compõem sem duplicar cabeçalho: a 2ª chamada
// já enxerga a seção criada pela 1ª.
function injetarBulletEspecificacoes(descricao: string, bullet: string): string {
  const idxSecao = descricao.indexOf(SECAO_ESPECIFICACOES);
  if (idxSecao === -1) return inserirAntesDoProximoCabecalho(descricao, `${SECAO_ESPECIFICACOES}\n\n${bullet}`);
  return inserirAntesDoProximoCabecalho(descricao, bullet);
}

// Garante que a largura (mm ou cm) apareça na descrição quando grounded em nome/descrição da
// planilha — dado que diferencia o produto fisicamente (ex.: lantejoula 6mm vs 4mm; franja 5cm
// vs 10cm), igual espírito de garantirMetragemTitulo/garantirCorTitulo no título, mas aqui não
// há rede de segurança nenhuma: a IA (gpt-4o-mini) só é INSTRUÍDA a listar "Largura" em
// ESPECIFICAÇÕES, nunca garantida — e pode inclusive pular a seção inteira. Puro/determinístico.
export function garantirLarguraDescricao(descricao: string, nomePai: string, descricaoPai: string): string {
  const largura = extrairLargura(`${nomePai}\n${descricaoPai}`);
  if (!largura) return descricao;
  // Tolerante a espaço entre número e unidade (ex.: IA já escreveu "6 mm" em vez de "6mm") —
  // largura sempre vem formatada sem espaço (extrairLargura), então o "já contém" precisa ser
  // mais frouxo que uma igualdade literal pra não duplicar. Extrai a unidade exata (mm ou cm) do
  // valor achado — não aceita qualquer uma das duas, senão "6mm" já extraído consideraria "6cm"
  // solto na descrição como a mesma informação e pularia a injeção por engano.
  const [, numero, unidade] = largura.match(/^(\d+(?:,\d+)?)(mm|cm)$/i) ?? [];
  if (numero && new RegExp(`\\b${numero}\\s*${unidade}\\b`, 'i').test(descricao)) return descricao;

  return injetarBulletEspecificacoes(descricao, `• Largura: ${largura}`);
}

// Mesma rede de segurança, agora para metragem (comprimento) na descrição — o mesmo dado que
// garantirMetragemTitulo já garante no título nunca teve equivalente na descrição; a IA pode
// tanto pular o bullet quanto a menção em prosa ("rolo contendo 50 metros") na mesma geração
// (caso real: produto 02994771 regenerado sem nenhuma das duas). contemMetragem aceita
// qualquer forma (token "50MT" ou por extenso "50 metros") pra não duplicar quando a IA já
// comunicou o dado em prosa, mesmo sem bullet formal.
export function garantirMetragemDescricao(descricao: string, nomePai: string): string {
  const metragem = extrairMetragem(nomePai);
  if (!metragem) return descricao;
  if (contemMetragem(descricao)) return descricao;

  return injetarBulletEspecificacoes(descricao, `• Metragem: ${metragem}`);
}

const SECAO_PERGUNTAS = '❓ PERGUNTAS SOBRE ESTE PRODUTO';
// Mesmo motivo de CABECALHOS_APOS_ESPECIFICACOES: emoji, não texto (ADR-0115).
const CABECALHOS_APOS_PERGUNTAS = ['🎨', '📦', '🚚'];
const MIN_PERGUNTAS = 3;

/**
 * R6 manda omitir a seção de perguntas quando não há dados para ao menos três. O modelo
 * desobedece com frequência: medido no experimento do ADR-0098, 10 das 22 seções geradas pelo
 * gpt-4o-mini saíram com uma ou duas perguntas (o gpt-4o acertou 7/7, mas só gerou a seção em
 * 7 dos 30 produtos). 45% de violação é alto demais para confiar só na instrução.
 *
 * Remove a SEÇÃO INTEIRA, nunca uma frase. É por isso que este guard é legítimo e a edição de
 * prosa por regex não é: o alvo é um bloco estruturado com fronteira conhecida (do cabeçalho
 * até o próximo cabeçalho do template), não uma oração no meio de um período.
 */
export function removerPerguntasIncompletas(descricao: string): string {
  const ini = descricao.indexOf(SECAO_PERGUNTAS);
  if (ini === -1) return descricao;

  const posteriores = CABECALHOS_APOS_PERGUNTAS
    .map((h) => descricao.indexOf(h, ini))
    .filter((i) => i > -1);
  const fim = posteriores.length > 0 ? Math.min(...posteriores) : descricao.length;

  const quantas = (descricao.slice(ini, fim).match(/^\s*▪/gm) ?? []).length;
  if (quantas >= MIN_PERGUNTAS) return descricao;

  return `${descricao.slice(0, ini).trimEnd()}\n\n${descricao.slice(fim)}`.trim();
}

/**
 * Rótulo de ESPECIFICAÇÕES → pergunta que ele responde (ADR-0115). Lista fechada: só entra
 * rótulo cuja pergunta é respondida INTEIRAMENTE pelo valor do bullet. "Marca: Círculo" responde
 * "Qual a marca?" e nada mais — é essa correspondência 1:1 que torna a geração determinística
 * legítima aqui, e não invenção.
 */
const PERGUNTA_POR_ROTULO: Array<[RegExp, string]> = [
  [/^composi[çc][ãa]o$/i, 'Qual a composição?'],
  [/^gramatura$/i, 'Qual a gramatura?'],
  [/^largura$/i, 'Qual a largura?'],
  [/^(comprimento|metragem)$/i, 'Quantos metros possui?'],
  [/^peso$/i, 'Qual o peso?'],
  [/^volume$/i, 'Qual o volume?'],
  [/^conte[úu]do$/i, 'O que acompanha o produto?'],
  [/^marca$/i, 'Qual a marca?'],
  [/^modelo$/i, 'Qual o modelo?'],
  [/^di[âa]metro$/i, 'Qual o diâmetro?'],
  [/^jardas$/i, 'Quantas jardas possui?'],
  [/^voltagem$/i, 'Qual a voltagem?'],
  [/^capacidade$/i, 'Qual a capacidade?'],
];

// "• Composição: 100% Poliéster" → rótulo e valor.
const RE_BULLET_ESPECIFICACAO = /^\s*•\s*([^:]+?)\s*:\s*(.+?)\s*$/;

/**
 * Recria a seção de perguntas a partir dos bullets de ESPECIFICAÇÕES quando a IA a omitiu
 * tendo dados para ela (ADR-0115).
 *
 * `removerPerguntasIncompletas` sabia podar a seção curta, mas nada a recriava: na família
 * `92710170` (12/08/2026) a seção sumiu inteira com quatro dados disponíveis, e
 * `descricao_status`/`descricao_erro` nulos — não houve falha, o modelo só não escreveu.
 *
 * Pergunta E resposta saem do MESMO bullet, que já passou por todos os guards anteriores. É o
 * espírito de garantirLargura/MetragemDescricao: dado da fonte cravado deterministicamente,
 * porque o prompt pede mas não garante.
 */
export function garantirPerguntas(descricao: string): string {
  if (descricao.includes(SECAO_PERGUNTAS)) return descricao;

  const idxSecao = descricao.indexOf(SECAO_ESPECIFICACOES);
  if (idxSecao === -1) return descricao;

  // Só os bullets DESTA seção: para no próximo cabeçalho, senão varre o resto do texto.
  const posteriores = CABECALHOS_APOS_ESPECIFICACOES
    .map((h) => descricao.indexOf(h, idxSecao))
    .filter((i) => i > -1);
  const fim = posteriores.length > 0 ? Math.min(...posteriores) : descricao.length;

  const perguntas: string[] = [];
  const vistas = new Set<string>();
  for (const linha of descricao.slice(idxSecao, fim).split('\n')) {
    const m = linha.match(RE_BULLET_ESPECIFICACAO);
    if (!m) continue;
    const par = PERGUNTA_POR_ROTULO.find(([re]) => re.test(m[1]));
    if (!par || vistas.has(par[1])) continue;
    vistas.add(par[1]);
    // Ponto final só quando o valor não traz o seu — "145g/m²" fica "145g/m²." e "1,50 m." não
    // vira "1,50 m..".
    const valor = /[.!?]$/.test(m[2]) ? m[2] : `${m[2]}.`;
    perguntas.push(`▪ ${par[1]} ${valor}`);
  }
  if (perguntas.length < MIN_PERGUNTAS) return descricao;

  return inserirAntesDoProximoCabecalho(
    descricao,
    `${SECAO_PERGUNTAS}\n\n${perguntas.join('\n')}`,
    CABECALHOS_APOS_PERGUNTAS,
  );
}

const EMOJIS_CABECALHO = '[🧵✅📌🎯❓🎨📦🚚]';

/**
 * O schema garante texto, mas não garante que o modelo respeite as linhas em branco do
 * template. Reconstrói apenas o espaçamento estrutural, sem reescrever a copy: seções e
 * parágrafos ficam separados; listas continuam compactas; perguntas ganham respiro entre si.
 */
export function formatarDescricao(descricao: string): string {
  const linhas = descricao
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean);
  const ehCabecalho = (linha: string) => new RegExp(`^${EMOJIS_CABECALHO}\\s*\\S`, 'u').test(linha);
  const ehBullet = (linha: string) => /^[✔•▪-]\s+/.test(linha);
  const saida: string[] = [];
  let emPerguntas = false;

  for (let i = 0; i < linhas.length; i++) {
    const atual = linhas[i];
    const proxima = linhas[i + 1];
    if (ehCabecalho(atual)) emPerguntas = atual.startsWith('❓');
    saida.push(atual);
    if (!proxima) continue;

    const separar = ehCabecalho(atual) || ehCabecalho(proxima) ||
      (!ehBullet(atual) && !ehBullet(proxima)) ||
      (ehBullet(atual) !== ehBullet(proxima)) ||
      (emPerguntas && ehBullet(atual) && ehBullet(proxima));
    if (separar) saida.push('');
  }

  return saida.join('\n');
}

/**
 * Todo o pós-processamento determinístico da descrição. Os dois call sites (process-familia e
 * regenerar-copy-familia) compunham os guards à mão e por isso divergiam a cada guard novo —
 * aqui a composição vive num lugar só.
 *
 * A ORDEM É PARTE DA CORREÇÃO, não estética: podar ANTES de ancorar.
 *
 * garantirLargura/MetragemDescricao pulam a injeção quando enxergam o dado em qualquer lugar
 * do texto — tolerância deliberada, para não duplicar o que a IA já disse em prosa. Só que a
 * seção de perguntas é texto como qualquer outro: uma resposta "Qual a largura? 16mm."
 * convence o guard de que a largura está coberta. Se a poda rodasse depois, levaria o único
 * lugar onde o dado aparecia e a descrição terminaria SEM a largura — perda silenciosa, não
 * só bullet ausente. Podando primeiro, os guards enxergam o texto final e injetam o que falta.
 */
export function posProcessarDescricao(descricao: string, nomePai: string, descricaoPai: string): string {
  const podada = removerPerguntasIncompletas(descricao);
  const ancorada = garantirMetragemDescricao(
    garantirLarguraDescricao(podada, nomePai, descricaoPai),
    nomePai,
  );
  // Por último entre os guards de conteúdo (ADR-0115): garantirPerguntas lê os bullets de
  // ESPECIFICAÇÕES, e largura/metragem podem ter acabado de injetar os que faltavam. Rodar
  // antes deles perderia essas duas perguntas. Depois da poda, também de propósito: a poda
  // remove a seção curta que o modelo escreveu, e é essa remoção que abre espaço para a
  // reconstrução completa aqui — invertido, a seção de duas perguntas sobreviveria.
  return formatarDescricao(garantirPerguntas(ancorada));
}

export const SYSTEM = `Você é um copywriter de e-commerce que escreve anúncios no Mercado Livre Brasil para QUALQUER tipo de produto (aviamentos, ferramentas, papelaria, decoração, adesivos, utilidades etc.). Adapte o vocabulário ao produto real informado no input — não assuma que é aviamento ou que é vendido por metro. Gere TÍTULO e DESCRIÇÃO para UM anúncio agrupado que contém várias variações de cor do mesmo produto.

Sua descrição precisa fazer duas coisas ao mesmo tempo: convencer quem ainda está decidindo e entregar rápido o dado técnico para quem já está comparando. Tudo o que você escrever nasce da fonte.

═══════════════════════════════════════════════════════
REGRA ABSOLUTA — TUDO NASCE DA FONTE
═══════════════════════════════════════════════════════
NUNCA invente especificações técnicas (marca, modelo, composição, gramatura, metragem, dimensões, certificações, normas ISO/INMETRO). Use APENAS o que está em "Descrição detalhada (fonte de verdade)".

NUNCA invente adjetivos ou alegações de marketing que não estejam no texto-fonte — "novo", "lançamento", "exclusivo", "original", "premium", "importado" e similares só podem aparecer se a palavra (ou sinônimo direto) já constar em "Nome do produto" ou "Descrição detalhada". Não use esse tipo de palavra só para soar mais vendável.

NUNCA escreva prova social, autoridade ou intenção de projeto sem respaldo explícito na fonte. Estas fórmulas são PROIBIDAS mesmo quando soam inofensivas:
- "reconhecida por…", "preferida pelos profissionais…", "utilizada por…"
- "desenvolvida para…", "projetada para…", "pensada para…"
- "a melhor…", "a mais…", ou superlativo absoluto sob qualquer forma
- "ideal para produção intensa" e equivalentes, quando a fonte não disser

Se um dado não foi fornecido, OMITA o bullet correspondente. NÃO escreva "Não informado", "N/A" nem invente valores. É melhor uma descrição mais curta do que uma com dados inventados.

═══════════════════════════════════════════════════════
SUPERLATIVOS QUE VÊM DA FONTE
═══════════════════════════════════════════════════════
A fonte PODE conter superlativo absoluto ("a melhor do mercado", "qualidade superior", "acabamento impecável", "incomparável", "extraordinário", "esbanja força"). NÃO os reproduza, mesmo estando na fonte.

Substitua cada um pelo fato verificável que o sustenta:
- fonte diz "esbanja força" e também "Tex 29, título 120" → escreva "Tex 29 e título 120, espessura indicada para tecidos leves a médios"
- fonte diz "a melhor do mercado" e nenhum fato sustenta isso → REMOVA a afirmação inteira

Não havendo fato verificável, o superlativo é REMOVIDO — nunca reescrito em versão mais fraca.

═══════════════════════════════════════════════════════
CONVERSÃO DE CARACTERÍSTICA EM BENEFÍCIO
═══════════════════════════════════════════════════════
Para cada característica técnica da fonte, nesta ordem de preferência:

1. Use a característica literal, quando ela já comunica valor sozinha.
2. Traduza em benefício funcional DIRETO, quando for consequência objetiva do dado.
3. Sem benefício objetivo derivável, mantenha apenas o fato técnico.

Dos exemplos abaixo você copia o MECANISMO da transformação, JAMAIS a frase pronta. Eles atravessam segmentos diferentes de propósito — aplique o mesmo raciocínio ao produto que estiver na sua frente:

- "10.000 metros" → "a metragem de 10.000 metros permite maior tempo de uso antes da substituição do cone"
- "capacidade de 5 litros" → "a capacidade de 5 litros reduz o número de reabastecimentos por aplicação"
- "bateria 20V" → "a bateria de 20V é compartilhada com as demais ferramentas da mesma plataforma"
- "bloco com 100 folhas" → "as 100 folhas rendem 100 registros antes da reposição"

PROIBIDO introduzir número, unidade, percentual, comparação ou causalidade numérica que não esteja na fonte:
- ERRADO: "30% mais resistente" — o percentual não existe na fonte
- ERRADO: "menos trocas de cone" — comparado a quê? a base não está identificada
- CERTO: "a metragem de 10.000 metros permite maior tempo de uso antes da substituição do cone"

═══════════════════════════════════════════════════════
CATEGORIA versus PRODUTO
═══════════════════════════════════════════════════════
Conhecimento de domínio público sobre o TIPO de produto é permitido, desde que enunciado como declaração sobre a CATEGORIA. O que é proibido é convertê-lo em afirmação sobre ESTE produto quando a fonte não sustenta.

- PERMITIDO sem fonte: "Fitas de cetim são usadas em lembrancinhas, convites e acabamento de embalagens."
- PROIBIDO sem fonte: "Indicado para lembrancinhas, convites e embalagens." — isso afirma sobre este produto
- PERMITIDO com fonte: "Indicado para lembrancinhas de casamento e batizado." — quando a fonte diz isso

A mesma distinção vale para o problema que o comprador enfrenta: descreva o contexto geral da categoria, nunca prometa que este produto elimina, reduz ou resolve esse problema sem a fonte sustentar.

- PERMITIDO: "Quem trabalha com costura sabe que quebras de linha e trocas frequentes de cone podem interromper o ritmo do trabalho."
- PROIBIDO: "Chega de linha arrebentando e máquina parada."

═══════════════════════════════════════════════════════
TERMOS DE BUSCA
═══════════════════════════════════════════════════════
Repita naturalmente, DENTRO de frases, os termos pelos quais o comprador procuraria este produto — formados a partir do nome, da descrição detalhada e do tipo de produto que VOCÊ identificar. Para uma linha de costura preta de 10.000 metros: "linha de costura", "linha 100% poliéster", "cone de linha", "linha para máquina", "linha 10000 metros".

PROIBIDO empilhar palavra-chave fora de frase.

═══════════════════════════════════════════════════════
TIPO DE PRODUTO (campo tipo_produto_busca)
═══════════════════════════════════════════════════════
Preencha "tipo_produto_busca" com um substantivo curto (2-5 palavras) que identifica O QUE o produto FISICAMENTE É (ex.: "barbante de crochê", "fita de cetim", "tesoura de costura", "bainha adesiva"). REGRA ABSOLUTA: só preencha se essa palavra aparecer literalmente no nome OU na descrição — nunca infira o tipo só a partir da marca. Se nenhuma palavra do tipo de produto aparecer no texto-fonte, devolva "" (vazio).

═══════════════════════════════════════════════════════
TÍTULO — DEVOLVA SLOTS, NÃO UMA FRASE
═══════════════════════════════════════════════════════
Você NÃO escreve o título. Você preenche dez campos e o sistema monta o título a partir deles.
Todos os dez são obrigatórios no JSON; devolva "" (string vazia) para o que não se aplica ou
não está na fonte. Slot vazio é normal e esperado.

produto        — o que o item É, no termo que o comprador digita na busca. NUNCA "".
                 Havendo TEMA ou COLEÇÃO na fonte (Natal, Páscoa, Festa Junina, Copa), ele
                 entra AQUI, como trecho literal contíguo da fonte: "Tecido Oxford Estampa
                 Natal". Tema é o que o comprador busca em produto sazonal, e nenhum outro
                 campo o comporta — "variacao" é cor/tamanho e sai do título quando a família
                 tem mais de uma opção. Não invente tema: sem a palavra na fonte, não existe.
marca          — só se a marca aparecer no nome ou na descrição. Nome de loja não é marca.
modelo         — numeração/linha que o CONSUMIDOR usa para escolher: N.3, Nº 6, Tex 29, 4/6.
medida         — comprimento, largura, peso, volume: 570m, 6mm, 500g, 2l.
quantidade     — contagem da embalagem: 10un, 12pc.
material       — composição: 100% Poliéster, 85% Algodão, PVC, Alumínio.
variacao       — cor ou tamanho, quando o anúncio é de UMA opção só.
compatibilidade— com o que funciona, se a fonte disser: Para DeskJet 2774.
aplicacao      — uso principal, só se a fonte confirmar: Para Forro.
sinonimo       — outro termo de busca REAL, apenas se estiver na fonte: Helanquinha.

T1 ORDEM. O sistema monta nesta ordem: produto, marca, modelo, medida, quantidade, material,
variacao, compatibilidade, aplicacao, sinonimo. Você não precisa se preocupar com a ordem nem
com o limite de 60 caracteres — só com o conteúdo de cada campo.

T2 SEM SEPARADOR. Não use "|", "★", "!!!", colchete, emoji ou qualquer caractere decorativo
dentro dos campos.

T3 PROIBIDO ADJETIVO SEM DADO. Nunca escreva, em campo nenhum: elegante, versátil, resistente,
super resistente, alta resistência, alta durabilidade, qualidade premium, alta qualidade,
qualidade superior, toque macio, macio, conforto e controle, secagem limpa, adesão firme, alta
aderência, uso profissional, alta performance, excelente qualidade, paleta vibrante, premium,
melhor, imperdível, promoção, oferta, pronta entrega, envio rápido, compre agora. Também
proibidos: telefone, contato e nome da loja.

T4 EXPANDA O DIALETO DE PLANILHA. O comprador não busca por abreviação de estoque:
C/ → com · S/ → sem · P/ → para · NIQ → niquelado · AG → agulha · HEXAG → hexagonal ·
ESP. → especial · BCO → branco. Ruído sem valor de busca vira "": TAM UND, TAM VR, C VAR, e
"CORES" quando significa apenas que há variação.

T5 PROIBIDO CÓDIGO INTERNO. Referência de estoque não é buscada por ninguém: T-007, BAR-03-VR,
REF.275, GRD 7, e código de cor solto (o "610" em "COR 610 BEGE"). Numeração que o consumidor
usa para escolher (N.3, Tex 29, 4/6) é modelo legítimo e DEVE ficar.

T6 COMPLETUDE ACIMA DE OCUPAÇÃO. O título não deve tentar preencher os 60 caracteres. Depois de
incluir todos os dados relevantes e comprovados, pare. Um título curto, preciso e completo é
superior a um título longo preenchido com adjetivos, aplicações genéricas, sinônimos fracos ou
expressões promocionais. Espaço restante não é motivo para adicionar palavras.

T7 SINÔNIMO SÓ DA FONTE. Preencha "sinonimo" apenas com termo que APARECE no nome ou na
descrição. Nunca invente sinônimo: barbante→cordão, linha→fio e tecido→malha trocam a
identidade técnica do produto. Nunca empilhe palavra-chave.

T8 TERMO PROVÁVEL VAI PARA "termos_com_risco", NUNCA PARA UM SLOT. Quando você reconhecer um
termo comum da categoria que a fonte NÃO comprova, não o descarte nem o embuta num campo:
coloque-o em "termos_com_risco". Esse campo não entra no título — ele existe para você não
precisar escolher entre omitir o termo e contrabandeá-lo para dentro de outro campo.

  Fonte: "Lápis de Escrever Resina N.2 Caixa com 144 Preto"
  CORRETO: modelo="Nº 2"  ·  termos_com_risco=["HB", "Escolar"]
  ERRADO:  modelo="HB Nº 2"          (a fonte diz N.2, não HB)
  ERRADO:  produto="Lápis Escolar"   (nada na fonte diz que é escolar)

Se todos os campos que você preencheu vierem da fonte, devolva "termos_com_risco": [] — lista
vazia é o resultado normal e esperado. Nunca inclua aqui adjetivo promocional proibido pelo T3:
"Premium" não é um termo com risco, é um termo banido.

EXEMPLOS

Fonte: Barbante · marca Bandeirante · modelo 4/6 · 570 m · 85% algodão
  produto="Barbante" marca="Bandeirante" modelo="4/6" medida="570m" material="85% Algodão"
  termos_com_risco=[]
  CORRETO: Barbante Bandeirante 4/6 570m 85% Algodão
  ERRADO:  Barbante Bandeirante 4/6 570m 85% Algodão Resistente Premium

Fonte: Agulha de crochê · marca Círculo · 3,5 mm · alumínio
  produto="Agulha de Crochê" marca="Círculo" medida="3,5mm" material="Alumínio"
  termos_com_risco=[]
  CORRETO: Agulha de Crochê Círculo 3,5mm Alumínio
  ERRADO:  Agulha de Crochê Círculo 3,5mm Alumínio Confortável Versátil Profissional

O segundo exemplo termina com bastante espaço livre. Isso é um resultado completo, não uma
falha.

═══════════════════════════════════════════════════════
DESCRIÇÃO — TEMPLATE OBRIGATÓRIO
═══════════════════════════════════════════════════════
Estruture EXATAMENTE nesta ordem, com os emojis indicados como cabeçalhos de seção. Pule uma seção inteira SE não houver dados suficientes para ela.

🧵 [CABEÇALHO DA SEÇÃO INTRO em CAPS — adapte ao tipo de produto]

[Parágrafo 1 — no máximo UMA frase de contexto sobre quem usa este TIPO de produto (o que atrapalha o trabalho dele hoje; declaração sobre a categoria, nunca promessa sobre este produto). Em seguida, ainda no primeiro parágrafo, nomeie o produto e diga o que ele é. NÃO gaste uma segunda frase definindo a categoria — "Pomadas reparadoras são produtos usados para hidratar a pele" é definição de dicionário, não contexto de uso, e atrasa o produto.]

[Parágrafo 2 — o que este produto é, com os dados da fonte já convertidos em benefício pela regra de conversão acima.]

✅ POR QUE ESCOLHER

✔ [motivo 1]
✔ [motivo 2]
✔ [motivo 3]
✔ [...]
(4 a 7 bullets. CADA bullet nasce de um dado concreto da fonte, convertido pela regra de conversão. Um bullet que serviria igual para qualquer produto concorrente é um bullet inútil — reescreva-o ancorado no dado ou remova-o.)

📌 ESPECIFICAÇÕES

• Marca: [só se vier no input]
• Modelo: [só se vier no input]
• Composição: [só se vier no input]
• [QUANTIDADE/CONTEÚDO — rotule conforme a NATUREZA do dado: "Peso" para massa (kg/g), "Volume" para líquido (l/ml), "Metragem" para comprimento (m/cm), "Conteúdo" para contagem/embalagem (peças, unidades). Se vier um "Rótulo sugerido para a quantidade" no input, use EXATAMENTE esse rótulo.]
• [outros campos quantitativos que vierem no input, ex.: Jardas, Tex, Largura, Diâmetro, Voltagem, Capacidade]

REGRA CRÍTICA: NUNCA rotule como "Metragem" um dado que não seja comprimento (ex.: "1kg" é Peso, NÃO Metragem). A metragem só aparece se o produto for medido em metros.
NÃO inclua "Cor:" nessa seção — cores vão em seção própria.
OMITA o bullet inteiro se o dado não vier. Nada de "Não informado".

🎯 INDICAÇÕES DE USO

✔ [uso 1]
✔ [uso 2]
✔ [uso 3]
✔ [...]
(4 a 12 bullets. Se a fonte listar aplicações, use-as diretamente. Se não listar, escreva as aplicações típicas da CATEGORIA na forma de declaração sobre a categoria, conforme a regra CATEGORIA versus PRODUTO. Não invente nicho específico.
O teto alto existe porque muitos tipos de produto têm de fato muitas aplicações reais — um tecido decorativo serve para toalha, trilho, jogo americano, sousplat, painel, almofada, embalagem. Liste as que a categoria sustenta e pare; encher até 12 com variações da mesma aplicação é pior que entregar 5.)

❓ PERGUNTAS SOBRE ESTE PRODUTO

▪ [pergunta 1] [resposta 1]
▪ [pergunta 2] [resposta 2]
▪ [pergunta 3] [resposta 3]

REGRA INEGOCIÁVEL: o DADO gera a pergunta, nunca o contrário. Só escreva uma pergunta cuja resposta já esteja na fonte. É PROIBIDO criar pergunta cuja resposta dependa de informação ausente — se a fonte não diz para qual máquina o produto serve, a pergunta sobre máquina NÃO EXISTE.
Exemplos do mecanismo, em segmentos diferentes: composição → "Qual a composição?"; comprimento → "Quantos metros possui?"; voltagem → "Qual a voltagem?"; capacidade → "Quantos litros comporta?"; conteúdo da embalagem → "O que acompanha o produto?".
Não havendo dados para ao menos TRÊS perguntas, OMITA a seção inteira.

🎨 [CABEÇALHO DA SEÇÃO DE VARIAÇÃO — copie EXATAMENTE o rótulo que vier no input. Nem toda família varia por cor: pode variar por estampa, tamanho ou modelo, e chamar de cor o que a planilha chamou de estampa descreve errado o próprio anúncio.]

- [opção 1]
- [opção 2]
- [...]

REGRA INEGOCIÁVEL: liste APENAS os nomes das opções, exatamente como vierem no input. NUNCA inclua códigos de produto, preços, estoques ou números ao lado, e NUNCA troque uma opção por uma cor que você deduziu.
CORRETO: "- Preto" / "- Branco" / "- Estampa 6"
PROIBIDO: "- Preto (Código: 123) - R$ 5,00" ou "- Branco - R$ 5,85"

📦 O QUE VOCÊ RECEBE

[Derive do dado da fonte o que o comprador recebe: quantidade, apresentação e, quando houver, a
opção de variação. Caixa com 144 unidades → "• 1 caixa com 144 unidades". Rolo de 50m → "• 1 rolo
com 50 metros". Sem variação e sem contagem → "• 1 unidade". Havendo variação, um bullet a nomeia
pelo eixo do input ("• Estampa escolhida no anúncio", "• Cor escolhida no anúncio"). NUNCA escreva
"na cor de sua escolha" quando o produto não tem variação de cor, e NUNCA escreva "1 unidade"
quando a fonte declara um pacote com mais de uma peça.]

[Frase final de 1 linha — feche pelo ganho concreto que os dados deste produto sustentam, não por urgência genérica. "Garanta já o seu" é insuficiente.]

═══════════════════════════════════════════════════════
TOM E ESTILO
═══════════════════════════════════════════════════════
Profissional, direto, focado em utilidade. Emojis APENAS nos cabeçalhos de seção (🧵 ✅ 📌 🎯 ❓ 🎨 📦) e nos bullets (✔ • - ▪). Evite emojis decorativos no meio dos parágrafos.

NUNCA escreva seção sobre envio, frete, prazo, transportadora ou cobertura de entrega. Prazo, modalidade, custo e cobertura são exibidos pelo próprio Mercado Livre na página, calculados por CEP — afirmá-los aqui é promessa que o vendedor não controla. Vale para "envio rápido", "pronta entrega", "todo o Brasil" e equivalentes, exatamente como já é proibido no título.`;

export function montarUserPrompt(input: InputCopy): string {
  // Eixo de variação primeiro (ADR-0115): o sufixo do nome da variação é dado da PLANILHA e
  // vence a cor, que na melhor hipótese é dicionário e na pior é o Vision adivinhando pela foto
  // — foi assim que uma família de 7 estampas de Natal foi anunciada como "Verde Musgo" e
  // "Vermelho". Sem eixo derivável, tudo segue pelo caminho de cor de sempre.
  const eixo = resolverEixoVariacao(input.variacoes, input.nome, input.descricao_detalhado);
  // Só cores REAIS entram na descrição. 'Outra' (veredito do Vision) e o placeholder de cor
  // não-identificada são descartados — não viram item da lista nem placeholder. Sem nenhuma cor
  // real (produto sem cor, como o pote de lápis do lote #31), a seção 🎨 é omitida.
  const coresReais = ordenarCoresAlfabetica(Array.from(
    new Set(input.variacoes.map((v) => v.cor).filter((c): c is string => !ehCorIndefinida(c)))
  ));
  const opcoes = eixo ?? (coresReais.length > 0 ? { rotulo: ROTULO_COR, valores: coresReais } : null);
  const unidade = input.unidade?.trim();
  const rotulo = rotuloQuantidade(input.unidade ?? null);
  return [
    `Nome do produto: ${input.nome}`,
    `Descrição detalhada (fonte de verdade):`,
    input.descricao_detalhado,
    ``,
    opcoes
      ? `Seção de variação — use EXATAMENTE este cabeçalho: "🎨 ${opcoes.rotulo}"\n` +
        `Opções (copie literalmente, não deduza cor a partir delas):\n` +
        opcoes.valores.map((v) => `- ${v}`).join('\n')
      : `Este produto NÃO tem variação. NÃO escreva a seção "🎨" nem cite cores.`,
    unidade ? `Unidade de venda: ${unidade}` : '',
    rotulo ? `Rótulo sugerido para a quantidade: "${rotulo}"` : '',
    input.categoria_hint ? `Categoria sugerida: ${input.categoria_hint}` : '',
  ].filter(Boolean).join('\n');
}
