// ADR-0200, Adendo 1: medição real da foto do kit fiel à peça (fora da suíte). Roda o MESMO pipeline da edge
// `gerar-foto-kit` (ficha → geração ancorada → verificação → até 3 tentativas) sobre produtos reais, SÓ LEITURA:
// não grava no banco, não sobe ao storage, não publica nada. Guarda as imagens e um CSV por item da ficha.
//
// Uso (Deno, a partir da raiz do repo):
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… OPENROUTER_API_KEY=… \
//   deno run -A scripts/medir-foto-kit-fiel.ts --kits kits.json --saida /tmp/medicao-foto-kit [--limite-usd 5] [--so 1]
//     [--modelo <slug OpenRouter>] [--max-tentativas 3] [--reserva-usd 0.12]   (comparar modelos de imagem)
// kits.json: [{ "familia_id": "<uuid>", "cores": ["Bege Cru", "Cinza Escuro"] }, …] (fica fora do repo: é dado real).
// Não defina AI_MODEL_VISION: a produção usa o padrão de `modelos.ts`.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { adequadaAoML, dimensoesImagem, gerarImagem, MODELO_IMAGEM_PADRAO } from '../supabase/functions/_shared/ai/imagem.ts';
import {
  avaliar, extrairFicha, ITENS, lerVerificacao, MAX_TENTATIVAS, montarPedidoFiel, reprovacao, type Verificacao,
} from '../supabase/functions/_shared/ai/foto-kit-fiel.ts';
import { MODELO_VISION } from '../supabase/functions/_shared/ai/modelos.ts';

const arg = (n: string, d?: string) => { const i = Deno.args.indexOf(`--${n}`); return i >= 0 ? Deno.args[i + 1] : d; };
const kits: Array<{ familia_id: string; cores: string[] }> = JSON.parse(await Deno.readTextFile(arg('kits')!));
const saida = arg('saida', '/tmp/medicao-foto-kit')!;
const limiteUsd = Number(arg('limite-usd', '5'));
const so = Number(arg('so', String(kits.length)));
// Teto por tentativa para a trava de orçamento (geração + verificação), antes de gastar. Modelo caro: suba a reserva.
const RESERVA_TENTATIVA_USD = Number(arg('reserva-usd', '0.12'));
const MODELO = arg('modelo', MODELO_IMAGEM_PADRAO)!;
const QUALIDADE = arg('qualidade');
const TENTATIVAS = Math.min(MAX_TENTATIVAS, Number(arg('max-tentativas', String(MAX_TENTATIVAS))));

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
await Deno.mkdir(saida, { recursive: true });
const csv = `${saida}/resultado.csv`;
const q = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
await Deno.writeTextFile(csv, [
  'modelo', 'kit', 'produto', 'n_cores', 'cores', 'tentativa', 'aprovado', ...ITENS.map(([c]) => c),
  'custo_ficha_usd', 'custo_geracao_usd', 'custo_verificacao_usd', 'ms_ficha', 'ms_geracao', 'ms_verificacao', 'motivos',
].join(',') + '\n');

const b64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
let total = 0;
console.log(`modelo de imagem ${MODELO}${QUALIDADE ? ` qualidade ${QUALIDADE}` : ''}; visão ${MODELO_VISION}; limite US$ ${limiteUsd}`);

for (const [k, kit] of kits.slice(0, so).entries()) {
  const dir = `${saida}/kit-${String(k + 1).padStart(2, '0')}`;
  await Deno.mkdir(dir, { recursive: true });
  const { data: fam, error } = await sb.from('familias').select('titulo_ml, nome_pai, variacoes(cor, imagem_path, excluida_da_publicacao)').eq('id', kit.familia_id).single();
  if (error || !fam) { console.error(`kit ${k + 1}: família não lida`); continue; }
  const produto = String(fam.titulo_ml ?? fam.nome_pai);
  // Mesma escolha da edge: fotos das variações da cor, sem repetir, até o teto por cor (sem a checagem de moderação
  // do ML, que não muda a fidelidade medida).
  const porCor = Math.min(3, Math.floor(12 / kit.cores.length));
  const origem = kit.cores.map((c) => [...new Set((fam.variacoes as Array<{ cor: string | null; imagem_path: string | null; excluida_da_publicacao?: boolean }>)
    .filter((v) => !v.excluida_da_publicacao && v.imagem_path && String(v.cor ?? '').trim() === c).map((v) => v.imagem_path!))].slice(0, porCor * 2));
  if (origem.some((o) => o.length === 0)) { console.error(`kit ${k + 1}: cor sem foto`); continue; }
  const brutos = await Promise.all(origem.map((ps) => Promise.all(ps.map(async (p) => {
    const { data, error: e } = await sb.storage.from('imagens').download(p);
    if (e || !data) throw new Error(`download ${p}`);
    return { path: p, bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || 'image/jpeg' };
  }))));
  // Sem repetidas por conteúdo, até o teto (igual à edge).
  const bytes = await Promise.all(brutos.map(async (fs) => {
    const vistos = new Set<string>();
    const fica = [];
    for (const f of fs) {
      const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', f.bytes))).join(',');
      if (!vistos.has(h)) { vistos.add(h); fica.push(f); }
    }
    return fica.slice(0, porCor);
  }));
  for (const [i, fs] of bytes.entries()) origem[i] = fs.map((f) => f.path);
  for (const [i, fs] of bytes.entries()) for (const [j, f] of fs.entries()) await Deno.writeFile(`${dir}/original-${i + 1}-${j + 1}.${f.mime.split('/')[1] ?? 'jpg'}`, f.bytes);
  const grupos = bytes.map((fs, i) => ({ cor: kit.cores[i], urls: fs.map((f) => `data:${f.mime};base64,${b64(f.bytes)}`) }));
  let t0 = Date.now();
  const { ficha, custoUsd: custoFicha } = await extrairFicha(grupos, origem, 60_000);
  const msFicha = Date.now() - t0;
  total += custoFicha;
  await Deno.writeTextFile(`${dir}/ficha.json`, JSON.stringify(ficha, null, 2));
  console.log(`kit ${k + 1} ${produto} [${kit.cores.join(' + ')}]: ficha ${ficha.comprimento} ${ficha.proporcao_altura_largura} fotos ${origem.map((o) => o.length).join('/')} tons ${ficha.cores.map((c) => c.nome_tom).join(' / ')} (US$ ${custoFicha.toFixed(4)}, ${msFicha} ms)`);

  let motivos: string[] = [];
  for (let t = 1; t <= TENTATIVAS; t++) {
    if (total + RESERVA_TENTATIVA_USD > limiteUsd) { console.error(`PARADO: US$ ${total.toFixed(3)} + reserva passa do limite`); Deno.exit(2); }
    t0 = Date.now();
    let gerada: Awaited<ReturnType<typeof gerarImagem>>;
    try { gerada = await gerarImagem(MODELO, montarPedidoFiel({ ficha, grupos, motivos }), grupos.flatMap((g) => g.urls), 150_000, QUALIDADE ? { quality: QUALIDADE } : {}); }
    catch (e) { console.error(`kit ${k + 1} t${t}: falha da geração (${(e as Error).name} ${(e as { status?: number }).status ?? ''})`); break; }
    const msGeracao = Date.now() - t0;
    total += gerada.custoUsd;
    await Deno.writeFile(`${dir}/tentativa-${t}.${gerada.ext}`, gerada.bytes);
    let v: Verificacao; let custoVerif = 0; let msVerif = 0;
    if (!adequadaAoML(dimensoesImagem(gerada.bytes))) {
      v = reprovacao('Enquadramento: a foto saiu horizontal ou pequena.');
    } else {
      t0 = Date.now();
      try {
        const lida = await lerVerificacao(ficha, grupos, `data:${gerada.mime};base64,${b64(gerada.bytes)}`, 60_000);
        msVerif = Date.now() - t0;
        custoVerif = lida.custoUsd; total += custoVerif;
        v = avaliar(ficha, lida.json);
        await Deno.writeTextFile(`${dir}/verificacao-${t}.json`, JSON.stringify({ resposta: lida.json, veredito: v }, null, 2));
      } catch (e) { msVerif = Date.now() - t0; v = reprovacao(`verificação falhou (${(e as Error).name})`); }
    }
    const ok = new Map(v.itens.map((i) => [i.campo, i.ok]));
    await Deno.writeTextFile(csv, [
      QUALIDADE ? `${MODELO}:${QUALIDADE}` : MODELO, k + 1, q(produto), kit.cores.length, q(kit.cores.join(' + ')), t, v.aprovado ? 'sim' : 'nao',
      ...ITENS.map(([c]) => (ok.has(c) ? (ok.get(c) ? 'ok' : 'DIVERGE') : '')),
      t === 1 ? custoFicha.toFixed(5) : '0', gerada.custoUsd.toFixed(5), custoVerif.toFixed(5), t === 1 ? msFicha : 0, msGeracao, msVerif,
      q(v.motivos.join(' || ')),
    ].join(',') + '\n', { append: true });
    console.log(`  t${t}: ${v.aprovado ? 'APROVADA' : 'reprovada'} geração ${msGeracao} ms, verificação ${msVerif} ms | acumulado US$ ${total.toFixed(3)}${v.aprovado ? '' : ` | ${v.motivos.join(' || ').slice(0, 300)}`}`);
    if (v.aprovado) break;
    motivos = v.motivos;
  }
}
console.log(`TOTAL US$ ${total.toFixed(4)} — CSV ${csv}`);
