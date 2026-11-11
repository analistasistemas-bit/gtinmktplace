// SÓ DESENVOLVIMENTO (rota registrada em App.tsx apenas com `import.meta.env.DEV`; fora do bundle de produção).
// Harness de visualização da Galeria IA para prints sem login: a página real, com as edges trocadas por respostas
// falsas montadas com os dados da Fita Veludo (validação real de 11/11; sem ids). Nada sai do navegador.
// `?cen=div` mostra a divergência da etiqueta; `?cen=falha` faz o salvar falhar.
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';
import { QK } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth-store';
import type { Fato, Ficha, ImagemGaleria, Roteiro } from '@/lib/galeria/api';
import GaleriaIA from '../GaleriaIA';

const cen = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('cen');

const DESC_PAI = 'O fecho de contato (velcro) da Búfalo de 16 mm é a solução ideal para quem busca fixação firme, praticidade e alta resistência em detalhes delicados. Confeccionada em 100% poliéster durável, esta peça de 25 metros oferece alto rendimento.';
const DESC_ML = 'A Fita de Veludo de 16mm é a solução ideal para quem busca fixação firme, praticidade e alta resistência em detalhes delicados. Composição: 100% poliéster. Metragem: 25 metros.';

const svg = (fundo: string, rolo: string, texto = false) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 154"><rect width="120" height="154" fill="${fundo}"/>${texto ? '<rect x="12" y="14" width="70" height="9" rx="2" fill="#3b3f58"/><rect x="12" y="28" width="50" height="6" rx="2" fill="#7a7f99"/>' : ''}<ellipse cx="62" cy="122" rx="32" ry="5" fill="#00000022"/><circle cx="60" cy="88" r="30" fill="${rolo}" stroke="#c8c8d0"/><circle cx="60" cy="88" r="20" fill="none" stroke="#c8c8d0"/><circle cx="60" cy="88" r="10" fill="#cdb9a0"/></svg>`)}`;

function fatosIniciais(): Fato[] {
  const f = (campo: string, valor: string, estado: Fato['estado'], nome?: string, extra: Partial<Fato> = {}): Fato =>
    ({ campo, valor, estado, origem: estado === 'SUGERIDO' ? 'atributo_ml' : 'planilha', evidencia: nome ? { nome } : {}, ...extra });
  return [
    f('nome', 'FITAS DE VELUDO 16MM CORES C/25MTS', 'CONFIRMADO'),
    f('origem', 'importado', 'CONFIRMADO'),
    f('descricao_fornecedor', DESC_PAI, 'CONFIRMADO'),
    ...(['peso_gramas', 'altura_cm', 'largura_cm', 'comprimento_cm'] as const).map((c, i) => f(c, ['287', '3.5', '24.5', '24.5'][i], 'CONFIRMADO')),
    f('atributo:MATERIAL', '100% poliéster', 'SUGERIDO', 'Material'),
    cen === 'div'
      ? f('atributo:WIDTH', '16 mm', 'DIVERGENTE', 'Largura', { etiqueta: { legivel: true, valor: '15 mm', foto: { origem: 'referencia', ref: 'x', url: svg('#f4efe6', '#fbfbf7') }, caixa: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 } } })
      : f('atributo:WIDTH', '16 mm', 'SUGERIDO', 'Largura'),
    f('atributo:LENGTH', '25 m', 'SUGERIDO', 'Comprimento'),
    f('atributo:BRAND', 'BUFALO', 'SUGERIDO', 'Marca'),
    f('atributo:UNITS_PER_PACK', '1', 'SUGERIDO', 'Unidades por pacote'),
    f('titulo_ml', 'FITAS VELUDO 16MM 25M | 100% POLIÉSTER | ALTA RESISTÊNCIA', 'SUGERIDO'),
    f('descricao_ml', DESC_ML, 'SUGERIDO'),
  ];
}

/** Roteiro como a Fase A devolve para a Fita (ativas 1, 2, 4, 5; 3 e 7 travadas pela lupa; 6 sem passos). */
const roteiroFita = (): Roteiro => ({
  categoria: 'Fitas', contrato: 'Representar sempre a fita de veludo para fecho de contato, com largura de 16 mm, nas duas faces (macho e fêmea) na mesma cor escolhida. Não mostrar embalagem nem texto na cena.',
  missoes: [
    { missao: 1, ativa: true, cena: 'Rolos da fita na cor escolhida sobre fundo limpo e neutro.', fatosUsados: [] },
    { missao: 2, ativa: true, cena: 'A fita em uso: roupa infantil, acessório compacto e artesanato.', headline: 'Versátil no dia a dia', subheadline: 'Laços, tiaras, embalagens de presente e decoração de festas infantis', fatosUsados: ['descricao_fornecedor'] },
    { missao: 3, ativa: false, cena: '', fatosUsados: [], motivoDesligada: 'Lupa em ajuste: a missão fica travada até a amostra real ser aprovada' },
    { missao: 4, ativa: false, cena: 'A fita ao lado de aplicações delicadas.', headline: 'Fixação prática e discreta', beneficios: ['Alta resistência', 'Praticidade na aplicação', 'Excelente aderência'], fatosUsados: ['descricao_fornecedor'] },
    { missao: 5, ativa: false, cena: 'Rolo e as duas faces da fita, organizados.', headline: 'Dados do produto', specs: [{ campo: 'atributo:MATERIAL', rotulo: 'Material', valor: '100% poliéster' }, { campo: 'atributo:LENGTH', rotulo: 'Comprimento', valor: '25 m' }], fatosUsados: [] },
    { missao: 6, ativa: false, cena: '', fatosUsados: [], motivoDesligada: 'Sem etapa de uso escrita nos dados confirmados (R5.3)' },
    { missao: 7, ativa: false, cena: '', fatosUsados: [], motivoDesligada: 'Lupa em ajuste: a missão fica travada até a amostra real ser aprovada' },
  ],
});

const estado = { fatos: fatosIniciais(), roteiro: roteiroFita(), status: 'rascunho', versao: 1, geradas: [] as ImagemGaleria[] };
const ficha = (): Ficha => ({
  anuncio_externo_id: 'A1', familia_id: 'F1', codigo_pai: '02864', cores: ['Branco', 'Preto'], fatos: estado.fatos,
  fatos_hash: 'h', roteiro_desatualizado: false, referencias: {},
});
const resp = () => ({
  roteiro: { id: `R${estado.versao}`, familia_id: 'F1', versao: estado.versao, status: estado.status, moda: false, conteudo: estado.roteiro },
  erros: [], erros_por_missao: {}, ciencia_pendente: [], fatos: estado.fatos, moda: false, familia_id: 'F1',
});
const imagem = (id: string, missao: number, extra: Partial<ImagemGaleria> = {}): ImagemGaleria => ({
  id, cor: 'Branco', missao, geracao: 1, origem: 'gerador', status: 'gerada', alertas: [], erro: null, exibida: true,
  url: svg('#e9e9f0', '#fbfbf7', missao !== 1), ref_url: null, roteiro_id: `R${estado.versao}`, pode_gerar_de_novo: true, unit_cents: 50, ...extra,
});
const atraso = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function responder(edge: string, b: Record<string, unknown>): Promise<unknown> {
  await atraso(250);
  const acao = b.acao;
  if (edge === 'galeria-fatos') {
    if (acao === 'confirmar' || acao === 'manter_cadastro' || acao === 'corrigir_cadastro') {
      estado.fatos = estado.fatos.map((f) => (f.campo === b.campo
        ? { ...f, estado: 'CONFIRMADO', valor: acao === 'corrigir_cadastro' ? String(b.valor) : f.valor, origem: 'confirmado_operador' } : f));
    }
    return ficha();
  }
  if (edge === 'galeria-roteiro') {
    if (acao === 'salvar') {
      if (cen === 'falha') throw new Error('falha_interna');
      estado.roteiro = b.conteudo as Roteiro;
      if (estado.status !== 'rascunho') { estado.versao += 1; estado.status = 'rascunho'; }
    }
    if (acao === 'aprovar') { estado.status = 'aprovado'; return { roteiro_id: `R${estado.versao}`, status: 'aprovado', fatos_hash: 'h' }; }
    return resp();
  }
  if (edge === 'galeria-imagens') {
    const aprovado = estado.status === 'aprovado';
    return {
      roteiro: aprovado ? { id: `R${estado.versao}`, versao: estado.versao, familia_id: 'F1', moda: false, missoes_ativas: estado.roteiro.missoes.filter((m) => m.ativa).map((m) => m.missao), textos: {} } : null,
      unit_cents: 50, imagens: estado.geradas,
    };
  }
  if (edge === 'galeria-gerar') {
    const missoes = b.missoes as number[];
    estado.geradas = missoes.flatMap((m, i) => (b.cores as string[]).map((c) => imagem(`i${m}${c}`, m, { cor: c, alertas: i === 1 ? [{ tipo: 'texto', nota: 'O texto do rótulo pode ter mudado. Confira antes de aprovar.' }] : [] })));
    return { pedido_id: b.pedido_id, imagens: [] };
  }
  if (edge === 'galeria-aplicar') return acao === 'estado' ? { aplicacoes: [] } : { aplicacao_id: 'AP1', status: 'preparada', itens: ['MLB7168683146'], manifesto: [] };
  return {};
}

// Troca as edges e a sessão só nesta rota de desenvolvimento.
// `supabase.functions` é um getter que cria um cliente novo a cada acesso: troca no protótipo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Object.getPrototypeOf(supabase.functions) as any).invoke = async (edge: string, { body }: { body: Record<string, unknown> }) => {
  try { return { data: await responder(edge, body), error: null }; } catch (e) {
    return { data: null, error: { context: new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 }) } };
  }
};
useAuthStore.setState({ profile: { is_admin: true } as never, profileLoading: false });
queryClient.setQueryDefaults(QK.publicados, { staleTime: Infinity });
queryClient.setQueryData(QK.modulosHabilitados, ['imagem_ia']);
queryClient.setQueryData(QK.publicados, [{
  familiaId: 'F1', codigoPai: '02864', gtin: null, titulo: 'FITAS VELUDO 16MM 25M | 100% POLIÉSTER | ALTA RESISTÊNCIA', fornecedor: null,
  tipo: null, categoria: null, precoPublicacao: 28.4, precoPublicacaoMax: 28.4, descricao: null, mlItemId: 'MLB7168683146', mlPermalink: null, publicadoEm: null,
}]);

export default function GaleriaHarness() {
  return (
    <main className="h-screen overflow-y-auto overflow-x-hidden bg-muted/30">
      <GaleriaIA />
    </main>
  );
}
