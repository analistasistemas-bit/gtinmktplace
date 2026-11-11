// SÓ DESENVOLVIMENTO (rota registrada em App.tsx apenas com `import.meta.env.DEV`; fora do bundle de produção).
// Harness de visualização da tela única da Galeria IA para prints sem login: a página real, com as edges trocadas por
// respostas falsas. Nada sai do navegador. Dados fixos cobrem todos os estados do cartão (cor Branco) e uma segunda cor
// (Preto) para a faixa "Todas as cores" (escolha "Todas as cores" no seletor do cabeçalho).
// Interativo: "Gerar" cria uma imagem que fica "Gerando…" por ~3 s e depois pronta; "Aprovar" aprova de mentira; a
// aplicação no anúncio é simulada (andando ~2 s, depois o fim).
// A cor Branco já abre com 2 imagens aprovadas (seção "Colocar no anúncio").
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';
import { QK } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth-store';
import type { ImagemGaleria, RespostaListar } from '@/lib/galeria/api';
import GaleriaIA from '../GaleriaIA';

const svg = (fundo: string, rolo: string) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1540"><rect width="1200" height="1540" fill="${fundo}"/><ellipse cx="620" cy="1220" rx="320" ry="50" fill="#00000022"/><circle cx="600" cy="880" r="300" fill="${rolo}" stroke="#c8c8d0" stroke-width="8"/><circle cx="600" cy="880" r="200" fill="none" stroke="#c8c8d0" stroke-width="8"/><circle cx="600" cy="880" r="100" fill="#cdb9a0"/></svg>`)}`;

const POSICOES = [
  { posicao: 1, nome: 'Capa' }, { posicao: 2, nome: 'Em uso' }, { posicao: 3, nome: 'Tira-dúvida' }, { posicao: 4, nome: 'Benefícios' },
  { posicao: 5, nome: 'Ficha técnica', indisponivel: 'Faltam dados do produto para esta imagem.' }, { posicao: 6, nome: 'Como usar' },
  { posicao: 7, nome: 'Detalhes' },
];
const PLANO = 'P1';
const imagem = (id: string, cor: string, missao: number, extra: Partial<ImagemGaleria> = {}): ImagemGaleria => ({
  id, cor, missao, geracao: 1, status: 'gerada', alertas: [], erro: null, exibida: true,
  url: svg('#e9e9f0', cor === 'Preto' ? '#3a3a44' : '#fbfbf7'), roteiro_id: PLANO, pode_gerar_de_novo: true, unit_cents: 50, ...extra,
});

/** Branco: aprovada, pronta com versão aprovada mais antiga, pronta com os 3 alertas, gerando, falhou, indisponível (5), vazio (7 sem imagem). */
const imgs: ImagemGaleria[] = [
  imagem('b1', 'Branco', 1, { status: 'aprovada' }),
  imagem('b2a', 'Branco', 2, { status: 'aprovada' }),
  imagem('b2b', 'Branco', 2, { geracao: 2 }),
  imagem('b3', 'Branco', 3, { alertas: [
    { tipo: 'texto_extra', nota: '"Super oferta"' }, { tipo: 'texto_faltando', nota: 'Prende firme' }, { tipo: 'verificacao_indisponivel', nota: '' },
  ] }),
  imagem('b4', 'Branco', 4, { status: 'gerando', url: null, exibida: false }),
  imagem('b6', 'Branco', 6, { status: 'falhou', url: null, erro: 'teto', geracao: 3, pode_gerar_de_novo: false }),
  // Preto: esperando a conferência do texto, roteiro antigo, conferência fora do ar.
  imagem('p1', 'Preto', 1, { alertas: null }),
  imagem('p2', 'Preto', 2, { roteiro_id: 'P0' }),
  imagem('p3', 'Preto', 3, { alertas: [{ tipo: 'verificacao_indisponivel', nota: '' }] }),
];
const abertas = new Map<string, number>();

const atraso = (ms: number) => new Promise((r) => setTimeout(r, ms));
function listar(): RespostaListar {
  const agora = Date.now();
  return {
    titulo: 'FITAS VELUDO 16MM 25M | 100% POLIÉSTER | ALTA RESISTÊNCIA', cores: ['Branco', 'Preto'], moda: false, unit_cents: 50,
    posicoes: POSICOES, plano_id: PLANO,
    imagens: imgs.map((i) => (abertas.has(i.id) && agora > abertas.get(i.id)! ? { ...i, status: 'gerada', url: svg('#e9e9f0', '#fbfbf7') } : i)),
  };
}

// Aplicação no anúncio simulada.
const MLB = 'MLB7168683146';
const aplic = { modo: 'substituir', cor: 'Branco', confirmadaEm: 0, desfeita: false };
function preparar(b: Record<string, unknown>) {
  aplic.modo = String(b.modo); aplic.cor = String(b.cor); aplic.confirmadaEm = 0; aplic.desfeita = false;
  const aprovadas = imgs.filter((g) => g.status === 'aprovada' && g.cor === aplic.cor).sort((x, y) => x.missao - y.missao);
  const subst = aplic.modo === 'substituir';
  const hoje = [0, 1, 2].map((i) => ({ id: `H${i}`, url: svg(['#ededf1', '#e6e6ec', '#f1efe9'][i], '#fbfbf7'), sai: subst }));
  const novas = aprovadas.map((g) => ({ id: `novo-${g.missao}`, url: g.url, nova: true, missao: g.missao }));
  return {
    aplicacao_id: 'AP1', status: 'preparada', itens: [MLB],
    manifesto: aprovadas.map((g) => ({ imagem_id: g.id, missao: g.missao, final_sha256: 'x' })),
    previa: [{ item_id: MLB, antes: hoje, depois: subst ? novas : [...hoje.map(({ id, url }) => ({ id, url, nova: false })), ...novas] }],
  };
}
function estadoAplic() {
  if (!aplic.confirmadaEm) return { aplicacoes: [] };
  const andando = Date.now() - aplic.confirmadaEm < 2500;
  const status = aplic.desfeita ? 'revertida' : andando ? 'em_andamento' : 'aplicada';
  const item = aplic.desfeita ? 'compensado' : andando ? 'subindo' : 'aplicado';
  return { aplicacoes: [{ id: 'AP1', cor: aplic.cor, modo: aplic.modo, status, manifesto: [], itens: [{ item_id: MLB, status: item, erro: null }] }] };
}

async function responder(edge: string, b: Record<string, unknown>): Promise<unknown> {
  await atraso(250);
  const acao = b.acao;
  if (edge === 'galeria-imagens') return acao === 'listar' ? listar() : acao === 'confirmar_exibicao' ? { cobradas: 1 } : { reportada: true };
  if (edge === 'galeria-gerar') {
    for (const m of b.missoes as number[]) {
      for (const c of b.cores as string[]) {
        const id = `n${m}${c}${Date.now()}`;
        imgs.push(imagem(id, c, m, { geracao: 9, status: 'gerando', url: null, exibida: false }));
        abertas.set(id, Date.now() + 3000);
      }
    }
    return { pedido_id: b.pedido_id, imagens: [] };
  }
  if (edge === 'galeria-aprovar') {
    if (acao === 'preparar_upload') return { path: 'harness/final.jpg', token: 't', signed_url: 'u' };
    const i = imgs.find((x) => x.id === b.imagem_id);
    if (i) i.status = 'aprovada';
    return { status: 'aprovada' };
  }
  if (edge === 'galeria-aplicar') {
    if (acao === 'preparar') return preparar(b);
    if (acao === 'confirmar') { aplic.confirmadaEm = Date.now(); return { status: 'em_andamento' }; }
    if (acao === 'reverter') { aplic.desfeita = true; return { status: 'revertendo' }; }
    return estadoAplic();
  }
  return {};
}

// Troca as edges, o upload e a sessão só nesta rota de desenvolvimento.
// `supabase.functions` é um getter que cria um cliente novo a cada acesso: troca no protótipo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Object.getPrototypeOf(supabase.functions) as any).invoke = async (edge: string, { body }: { body: Record<string, unknown> }) => {
  try { return { data: await responder(edge, body), error: null }; } catch (e) {
    return { data: null, error: { context: new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 }) } };
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Object.getPrototypeOf(supabase.storage) as any).from = () => ({ uploadToSignedUrl: async () => ({ error: null }) });
useAuthStore.setState({ profile: { is_admin: true } as never, profileLoading: false });
queryClient.setQueryDefaults(QK.publicados, { staleTime: Infinity });
queryClient.setQueryData(QK.modulosHabilitados, ['imagem_ia']);
queryClient.setQueryData(QK.publicados, [{
  familiaId: 'F1', codigoPai: '02864', gtin: null, titulo: 'FITAS VELUDO 16MM 25M | 100% POLIÉSTER | ALTA RESISTÊNCIA', fornecedor: null,
  tipo: null, categoria: null, precoPublicacao: 28.4, precoPublicacaoMax: 28.4, descricao: null, mlItemId: MLB, mlPermalink: null, publicadoEm: null,
}]);

export default function GaleriaHarness() {
  return (
    <main className="h-screen overflow-y-auto overflow-x-hidden bg-muted/30">
      <GaleriaIA />
    </main>
  );
}
