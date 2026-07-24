import { ordenarCoresAlfabetica } from '../cor/ordenar.ts';
import { ehCorIndefinida } from '../cor/indefinida.ts';
import { rotuloQuantidade } from './unidade.ts';

export interface InputCopy {
  nome: string;
  descricao_detalhado: string;
  variacoes: Array<{ codigo: string; cor: string | null; preco: number }>;
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

// Captura largura em mm do texto-fonte (ex.: "6MM DE LARGURA", "LARGURA DE 6MM", "LARGURA: 6MM").
// Exige a palavra LARGURA perto do número — "M"/"MT"/"METROS" (metragem, tratada em titulo.ts)
// nunca colide aqui porque a unidade exigida é MM, não M.
const RE_LARGURA_MM = /(\d+(?:,\d+)?)\s*MM\s+DE\s+LARGURA\b|LARGURA\s*:?\s*(?:DE\s*)?(\d+(?:,\d+)?)\s*MM\b/i;

export function extrairLarguraMm(texto: string): string | null {
  const m = texto.match(RE_LARGURA_MM);
  if (!m) return null;
  return `${m[1] ?? m[2]}mm`;
}

const SECAO_ESPECIFICACOES = '📌 ESPECIFICAÇÕES';
// Ordem do template (SYSTEM acima) a partir de ESPECIFICAÇÕES — usada só para achar onde a
// seção termina, caso ela exista, ou onde inserir uma nova, caso a IA tenha pulado a seção
// inteira (bug real: produto 02994771 saiu sem "📌 ESPECIFICAÇÕES" nenhuma).
const CABECALHOS_APOS_ESPECIFICACOES = [
  '🎯 INDICAÇÕES DE USO',
  '🎨 CORES DISPONÍVEIS',
  '📦 CONTEÚDO DA EMBALAGEM',
  '🚚 ENVIO RÁPIDO',
];

function inserirAntesDoProximoCabecalho(descricao: string, bloco: string): string {
  const posicoes = CABECALHOS_APOS_ESPECIFICACOES
    .map((h) => descricao.indexOf(h))
    .filter((i) => i > -1);
  const idx = posicoes.length > 0 ? Math.min(...posicoes) : descricao.length;
  return `${descricao.slice(0, idx).trimEnd()}\n\n${bloco}\n\n${descricao.slice(idx)}`.trim();
}

// Garante que a largura em mm apareça na descrição quando grounded em nome/descrição da
// planilha — dado que diferencia o produto fisicamente (ex.: lantejoula 6mm vs 4mm), igual
// espírito de garantirMetragemTitulo/garantirCorTitulo no título, mas aqui não há rede de
// segurança nenhuma: a IA (gpt-4o-mini) só é INSTRUÍDA a listar "Largura" em ESPECIFICAÇÕES,
// nunca garantida — e pode inclusive pular a seção inteira. Puro/determinístico.
export function garantirLarguraDescricao(descricao: string, nomePai: string, descricaoPai: string): string {
  const largura = extrairLarguraMm(`${nomePai}\n${descricaoPai}`);
  if (!largura) return descricao;
  if (new RegExp(`\\b${largura}\\b`, 'i').test(descricao)) return descricao;

  const bullet = `• Largura: ${largura}`;
  const idxSecao = descricao.indexOf(SECAO_ESPECIFICACOES);
  if (idxSecao === -1) return inserirAntesDoProximoCabecalho(descricao, `${SECAO_ESPECIFICACOES}\n\n${bullet}`);
  return inserirAntesDoProximoCabecalho(descricao, bullet);
}

export const SYSTEM = `Você é um copywriter de e-commerce que escreve anúncios no Mercado Livre Brasil para QUALQUER tipo de produto (aviamentos, ferramentas, papelaria, decoração, adesivos, utilidades etc.). Adapte o vocabulário ao produto real informado no input — não assuma que é aviamento ou que é vendido por metro. Gere TÍTULO e DESCRIÇÃO para UM anúncio agrupado que contém várias variações de cor do mesmo produto.

═══════════════════════════════════════════════════════
REGRA ABSOLUTA — ANTI-ALUCINAÇÃO
═══════════════════════════════════════════════════════
NUNCA invente especificações técnicas (marca, modelo, composição, gramatura, metragem, dimensões, certificações, normas ISO/INMETRO). Use APENAS o que está em "Descrição detalhada (fonte de verdade)".

NUNCA invente adjetivos ou alegações de marketing que não estejam no texto-fonte — "novo", "lançamento", "exclusivo", "original", "premium", "importado" e similares só podem aparecer se a palavra (ou sinônimo direto) já constar em "Nome do produto" ou "Descrição detalhada". Não use esse tipo de palavra só para soar mais vendável.

Se um dado não foi fornecido, OMITA o bullet correspondente. NÃO escreva "Não informado", "N/A" nem invente valores. É melhor uma descrição mais curta do que uma com dados inventados.

Aplicações de uso genéricas do tipo de produto (ex.: "linha serve para costura em geral, reparos, artesanato") SÃO PERMITIDAS por serem conhecimento de domínio público.

═══════════════════════════════════════════════════════
TIPO DE PRODUTO (campo tipo_produto_busca)
═══════════════════════════════════════════════════════
Preencha "tipo_produto_busca" com um substantivo curto (2-5 palavras) que identifica O QUE o produto FISICAMENTE É (ex.: "barbante de crochê", "fita de cetim", "tesoura de costura", "bainha adesiva"). REGRA ABSOLUTA: só preencha se essa palavra aparecer literalmente no nome OU na descrição — nunca infira o tipo só a partir da marca. Se nenhuma palavra do tipo de produto aparecer no texto-fonte, devolva "" (vazio).

═══════════════════════════════════════════════════════
TÍTULO
═══════════════════════════════════════════════════════
- Até 60 caracteres.
- Formato: \`MARCA MODELO MEDIDA | CARACTERÍSTICA PRINCIPAL | DIFERENCIAL\`
- Exemplo: \`FITA CETIM PROGRESSO N.1 100MT | 100% POLIÉSTER | RESISTENTE\`
- TUDO EM CAPS.
- Se o NOME do produto não contém uma palavra que identifique o tipo do produto (ex.: "EUROROMA 4/6 CORES 600G" não diz o que é), mas a descrição diz (ex.: "BARBANTE"), esse substantivo é OBRIGATÓRIO como primeiro segmento do título — à frente até da marca. Prioridade de conteúdo quando faltar espaço: TIPO DE PRODUTO > MEDIDA > MARCA > DIFERENCIAL (corte o DIFERENCIAL antes de cortar o tipo).
- SE o nome do produto contém medida ou quantidade (ex.: 10MT, 100MT, 50M, 1KG, 500G), inclua-a OBRIGATORIAMENTE no título logo após o modelo. É dado crucial que diferencia o produto (10MT e 100MT são produtos distintos; 1KG e 500G também) — priorize a medida real sobre adjetivos genéricos de "DIFERENCIAL".
- O segmento "DIFERENCIAL" é OPCIONAL. Só inclua se a palavra/frase couber INTEIRA dentro dos 60 caracteres. NUNCA corte uma palavra no meio nem termine o título com conectivo solto (ex.: "... VERSÁTIL E", "... DE", "... COM"). Prefira um título mais curto e completo (ex.: "... | 100% POLIÉSTER") a um terminado em fragmento.
- NUNCA mencione quantidade de cores nem "Disponível em N cores".
- Use apenas dados do input.

═══════════════════════════════════════════════════════
DESCRIÇÃO — TEMPLATE OBRIGATÓRIO
═══════════════════════════════════════════════════════
Estruture EXATAMENTE nesta ordem, com os emojis indicados como cabeçalhos de seção. Pule uma seção inteira SE não houver dados suficientes para ela.

🧵 [CABEÇALHO DA SEÇÃO INTRO em CAPS — adapte ao tipo de produto. Ex.: "QUALIDADE PROFISSIONAL PARA SUAS COSTURAS"]

[Parágrafo 1 — apresentação do produto e público típico, usando dados do input.]

[Parágrafo 2 — material/composição/desempenho, se disponível.]

Ideal para [aplicações típicas do tipo de produto — uso genérico permitido conforme o tipo (confecções, facções, malharias, artesanato, decoração, customização, reparos etc).]

✅ BENEFÍCIOS

✔ [benefício 1]
✔ [benefício 2]
✔ [benefício 3]
✔ [...]
(4 a 7 bullets. Use características reais do produto + benefícios genéricos do tipo: "Alta resistência", "Costura firme", "Bom rendimento", "Não desfia facilmente", "Ótimo custo-benefício".)

📌 ESPECIFICAÇÕES

• Marca: [só se vier no input]
• Modelo: [só se vier no input]
• Composição: [só se vier no input]
• [QUANTIDADE/CONTEÚDO — rotule conforme a NATUREZA do dado: "Peso" para massa (kg/g), "Volume" para líquido (l/ml), "Metragem" para comprimento (m/cm), "Conteúdo" para contagem/embalagem (peças, unidades). Se vier um "Rótulo sugerido para a quantidade" no input, use EXATAMENTE esse rótulo.]
• [outros campos quantitativos que vierem no input, ex.: Jardas, Tex, Largura, Diâmetro]

REGRA CRÍTICA: NUNCA rotule como "Metragem" um dado que não seja comprimento (ex.: "1kg" é Peso, NÃO Metragem). A metragem só aparece se o produto for medido em metros.
NÃO inclua "Cor:" nessa seção — cores vão em seção própria.
OMITA o bullet inteiro se o dado não vier. Nada de "Não informado".

🎯 INDICAÇÕES DE USO

✔ [uso 1]
✔ [uso 2]
✔ [uso 3]
✔ [...]
(4 a 6 bullets sobre aplicações típicas. Conhecimento de domínio público é permitido — não invente nichos específicos.)

🎨 CORES DISPONÍVEIS

- [cor 1]
- [cor 2]
- [...]

REGRA INEGOCIÁVEL: liste APENAS os nomes das cores. NUNCA inclua códigos de produto, preços, estoques ou números ao lado.
CORRETO: "- Preto" / "- Branco"
PROIBIDO: "- Preto (Código: 123) - R$ 5,00" ou "- Branco - R$ 5,85"

📦 CONTEÚDO DA EMBALAGEM

• 1 unidade do produto na cor de sua escolha

🚚 ENVIO RÁPIDO

Produto à pronta entrega com envio rápido e seguro para todo o Brasil.

[Frase final motivacional em 1 linha — call to action sobre aproveitar/garantir o produto.]

═══════════════════════════════════════════════════════
TOM E ESTILO
═══════════════════════════════════════════════════════
Profissional, direto, focado em utilidade. Emojis APENAS nos cabeçalhos de seção (🧵 ✅ 📌 🎯 🎨 📦 🚚) e nos bullets (✔ • -). Evite emojis decorativos no meio dos parágrafos.`;

export function montarUserPrompt(input: InputCopy): string {
  // Só cores REAIS entram na descrição. 'Outra' (veredito do Vision) e o placeholder de cor
  // não-identificada são descartados — não viram item da lista nem placeholder. Sem nenhuma cor
  // real (produto sem cor, como o pote de lápis do lote #31), a seção 🎨 CORES é omitida.
  const coresReais = ordenarCoresAlfabetica(Array.from(
    new Set(input.variacoes.map((v) => v.cor).filter((c): c is string => !ehCorIndefinida(c)))
  ));
  const unidade = input.unidade?.trim();
  const rotulo = rotuloQuantidade(input.unidade ?? null);
  return [
    `Nome do produto: ${input.nome}`,
    `Descrição detalhada (fonte de verdade):`,
    input.descricao_detalhado,
    ``,
    coresReais.length > 0
      ? `Cores disponíveis:\n${coresReais.map((c) => `- ${c}`).join('\n')}`
      : `Este produto NÃO tem variação de cor. NÃO escreva a seção "🎨 CORES DISPONÍVEIS" nem cite cores.`,
    unidade ? `Unidade de venda: ${unidade}` : '',
    rotulo ? `Rótulo sugerido para a quantidade: "${rotulo}"` : '',
    input.categoria_hint ? `Categoria sugerida: ${input.categoria_hint}` : '',
  ].filter(Boolean).join('\n');
}
