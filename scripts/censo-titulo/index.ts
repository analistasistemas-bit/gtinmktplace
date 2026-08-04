/**
 * Censo de padrões de texto na fonte de produto (ADR-0099) e saúde do pipeline de título.
 *
 * SOMENTE LEITURA — cada consulta é um SELECT único via management API do Supabase
 * (SUPABASE_ACCESS_TOKEN), a mesma credencial já usada por scripts/experimento-titulo/. Nenhum
 * INSERT/UPDATE/DELETE/DDL. Não chama OpenRouter nem nenhuma IA — mede só texto já gravado.
 *
 * Bloco A — sobre TODAS as famílias, procura na fonte (nome_pai + descricao_pai, ou só
 * nome_pai onde indicado) padrões que hoje não têm tratamento conhecido:
 *   A1a — "N unidades/x de <medida>" na mesma frase (contagem + volume/peso unitário)
 *   A1b — só "CAIXA/KIT/PACOTE COM N" (sem volume unitário)
 *   A2  — tokens SORT / VR / PAD isolados em nome_pai (VR isolado é reportado separado de
 *         "TAM VR", que já tem tratamento hoje)
 *   A3  — gramatura "G/M2", "G/M²", "GR/M2", "G/M 2" e variações
 *   A4  — token "PC" isolado (sem dígito colado antes — "12PC" não conta)
 *
 * Bloco B — saúde do pipeline em produção:
 *   B1 — total de famílias e quantas criadas a partir de 2026-08-02 (merge do ADR-0099)
 *   B2 — famílias em erro cuja mensagem venha de TituloInviavelError (titulo-montar.ts)
 *   B3 — distribuição de comprimento de titulo_ml das famílias criadas a partir de 2026-08-02
 *
 * Uso:
 *   SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=... pnpm tsx scripts/censo-titulo/index.ts
 */

const DATA_CORTE_ADR_0099 = '2026-08-02';

for (const v of ['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN']) {
  if (!process.env[v]) throw new Error(`falta a variável de ambiente ${v} — veja o cabeçalho deste arquivo`);
}

async function consultar<T>(sql: string): Promise<T[]> {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!r.ok) throw new Error(`management API ${r.status}: ${await r.text()}`);
  return (await r.json()) as T[];
}

type Familia = { codigo_pai: string; nome_pai: string | null; descricao_pai: string | null };

/** Janela de contexto ao redor do match, só para o exemplo ser legível no relatório. */
function contexto(texto: string, idx: number, len: number): string {
  const ini = Math.max(0, idx - 15);
  const fim = Math.min(texto.length, idx + len + 15);
  return texto.slice(ini, fim).replace(/\s+/g, ' ').trim();
}

type Exemplo = { codigo: string; trecho: string };

/**
 * Conta famílias DISTINTAS (uma por linha de `familias` — codigo_pai pode repetir entre orgs
 * multi-tenant, cada linha é uma família real) cujo texto bate com `regex`. `excluirSePrecedidoPor`
 * descarta um match cujos ~6 caracteres anteriores batam com ele (usado para separar "VR" isolado
 * de "TAM VR").
 */
function contarDistintas(
  rows: Familia[],
  campo: (r: Familia) => string,
  regex: RegExp,
  excluirSePrecedidoPor?: RegExp,
): { n: number; pct: string; exemplos: Exemplo[] } {
  let n = 0;
  const exemplos: Exemplo[] = [];
  for (const r of rows) {
    const texto = campo(r);
    if (!texto) continue;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    let bateu = false;
    let trecho = '';
    while ((m = regex.exec(texto))) {
      if (excluirSePrecedidoPor) {
        const antes = texto.slice(Math.max(0, m.index - 6), m.index);
        if (excluirSePrecedidoPor.test(antes)) continue;
      }
      bateu = true;
      trecho = contexto(texto, m.index, m[0].length);
      break;
    }
    if (bateu) {
      n += 1;
      if (exemplos.length < 5) exemplos.push({ codigo: r.codigo_pai, trecho });
    }
  }
  return { n, pct: ((n / rows.length) * 100).toFixed(1), exemplos };
}

function imprimir(rotulo: string, r: { n: number; pct: string; exemplos: Exemplo[] }) {
  console.log(`\n${rotulo}: ${r.n} (${r.pct}%)`);
  if (r.n === 0) { console.log('  zero ocorrências'); return; }
  for (const e of r.exemplos) console.log(`  ${e.codigo}: ${e.trecho}`);
}

async function blocoA() {
  const rows = await consultar<Familia>(`select codigo_pai, nome_pai, descricao_pai from familias`);
  const fonte = (r: Familia) => `${r.nome_pai ?? ''} ${r.descricao_pai ?? ''}`;
  const nome = (r: Familia) => r.nome_pai ?? '';

  console.log(`\n=== BLOCO A — padrões de texto na fonte (${rows.length} famílias) ===`);

  imprimir('A1a — contagem + volume/peso unitário na mesma frase', contarDistintas(
    rows, fonte,
    /\d+\s*[xX]\s*\d+\s*(ML|G|GR|KG|L|MG)\b|\d+\s+UNIDADES?\s+DE\s+\d+\s*(ML|G|GR|KG|L|MG)\b/gi,
  ));

  imprimir('A1b — só "CAIXA/KIT/PACOTE COM N" (sem volume unitário)', contarDistintas(
    rows, fonte, /\b(CAIXA|KIT|PACOTE)\s+COM\s+\d+\b/gi,
  ));

  imprimir('A2 — "SORT" isolado (nome_pai)', contarDistintas(rows, nome, /\bSORT\b/gi));
  imprimir('A2 — "TAM VR" (nome_pai, já tratado hoje)', contarDistintas(rows, nome, /\bTAM\s+VR\b/gi));
  imprimir('A2 — "VR" isolado excluindo "TAM VR" (nome_pai)', contarDistintas(
    rows, nome, /\bVR\b/gi, /\bTAM\s*$/i,
  ));
  imprimir('A2 — "PAD" isolado (nome_pai)', contarDistintas(rows, nome, /\bPAD\b/gi));

  imprimir('A3 — gramatura G/M2, G/M², GR/M2, G/M 2 e variações', contarDistintas(
    rows, fonte, /GR?\s?\/\s?M\s?[²2]/gi,
  ));

  imprimir('A4 — "PC" isolado (sem dígito colado antes)', contarDistintas(rows, fonte, /\bPC\b/gi));
}

async function blocoB() {
  console.log('\n=== BLOCO B — saúde do pipeline em produção ===');

  const [{ total, pos_adr }] = await consultar<{ total: number; pos_adr: number }>(`
    select count(*) as total,
           count(*) filter (where criado_em >= '${DATA_CORTE_ADR_0099}') as pos_adr
    from familias
  `);
  console.log(`\nB1 — total de famílias: ${total}; criadas a partir de ${DATA_CORTE_ADR_0099}: ${pos_adr}`);

  const erros = await consultar<{ codigo_pai: string; erro_mensagem: string }>(`
    select codigo_pai, erro_mensagem from familias
    where status = 'erro' and erro_mensagem is not null
  `);
  // Mensagens vêm de titulo-montar.ts: mensagemTituloInviavel() — 'ficou vazio' (produto zerado)
  // ou 'não cabe em 60 caracteres' (slots obrigatórios excedem o teto).
  const errosTitulo = erros.filter((e) =>
    /t[íi]tulo (ficou vazio|obrigat[óo]rio n[ãa]o cabe em 60)/i.test(e.erro_mensagem));
  console.log(`\nB2 — famílias em erro por título inviável: ${errosTitulo.length}/${erros.length} em erro`);
  if (errosTitulo.length === 0) console.log('  zero ocorrências');
  for (const e of errosTitulo.slice(0, 5)) console.log(`  ${e.codigo_pai}: ${e.erro_mensagem}`);

  const titulos = await consultar<{ len: number }>(`
    select length(titulo_ml) as len from familias
    where criado_em >= '${DATA_CORTE_ADR_0099}' and titulo_ml is not null
    order by len
  `);
  const lens = titulos.map((t) => t.len);
  const n = lens.length;
  if (n === 0) {
    console.log('\nB3 — não mensurável: nenhuma família com titulo_ml criada a partir do corte.');
    return;
  }
  const media = lens.reduce((a, b) => a + b, 0) / n;
  const mediana = n % 2 ? lens[(n - 1) / 2] : (lens[n / 2 - 1] + lens[n / 2]) / 2;
  const em60 = lens.filter((l) => l === 60).length;
  console.log(`\nB3 — comprimento de titulo_ml (n=${n}): min=${lens[0]} mediana=${mediana} `
    + `média=${media.toFixed(2)} max=${lens[n - 1]} exatamente 60 chars=${em60} (${((em60 / n) * 100).toFixed(1)}%)`);
}

async function main() {
  await blocoA();
  await blocoB();
}

main().catch((e) => { console.error(e); process.exit(1); });
