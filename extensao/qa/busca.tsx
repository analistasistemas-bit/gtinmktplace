// Harness de QA visual da busca (não entra no build de produção: o Vite só empacota sw e painel).
//   ?vista=painel (padrão)  → componente `Busca` REAL num contêiner de largura ?w=320|400|600
//   ?vista=grid             → grade falsa do ML com o `renderizarMiniBlocoDaBusca` REAL em cada card
//   &cenario=local|consultando|preenchido|parcial|nao_localizada|pausa (Task 11.4; sem = fixtures padrão)
// O tema escuro vem do `prefers-color-scheme` (emulado pelo Playwright), como no painel de verdade.
import { createRoot } from 'react-dom/client';
import { Busca } from '../src/painel/Busca';
import { renderizarMiniBlocoDaBusca } from '../src/conteudo/mini-bloco-busca';
import type { CardBusca } from '../src/leitura/busca';
import { AGORA_QA, cards, cenario, ENR, ESTADO, meta as META, resultados as RESULTADOS, type Cenario } from './busca-fixtures';
import { vistaDoCard, vistaDoFrete } from '../src/compartilhado/enriquecimento';
import { participacaoNosPisos } from '../src/compartilhado/busca-resumo';

const q = new URLSearchParams(location.search);
const raiz = document.getElementById('raiz')!;
const cen = q.get('cenario') as Cenario | null;
const dados = cen ? cenario(cen) : { enr: ENR, meta: META, resultados: RESULTADOS };
const { meta, resultados } = dados;
const estado = { ...ESTADO, resposta: { ...ESTADO.resposta, metadados: meta, resultados, enriquecimento: dados.enr } } as typeof ESTADO;

function painel() {
  import('../src/painel/painel.css');
  const w = Number(q.get('w') ?? 400);
  raiz.style.cssText = `width:${w}px;margin:0 auto;border-inline:1px dashed #8884`;
  createRoot(raiz).render(
    <>
      <header className="topo"><h1>PubliAI</h1></header>
      <main>
        <Busca
          estado={estado}
          chamar={(async () => ({ ok: false, erro: 'interno' })) as never}
          analisar={async (_f, retentar) => (retentar && cen === 'pausa' ? { ok: false, erro: 'aguardar', tentarAposEm: dados.enr?.tentarAposEm ?? Date.now() } : { ok: true })}
          destacar={() => {}}
        />
      </main>
    </>,
  );
}

// Preço NATIVO do ML (`.poly-price__current`): fica acima do ponto de inserção do Mini-bloco; o print prova que não é coberto.
const precoNativo = (n: number | null) => { const [f, c] = (n ?? 0).toFixed(2).split('.'); return { fraction: Number(f).toLocaleString('pt-BR'), cents: c }; };

function grade() {
  document.body.style.cssText = 'margin:0;background:#ebebeb;font:14px/1.3 "Proxima Nova",Arial,sans-serif;color:#333';
  const sel = [0, 1, 2, 'p2', 3, 5, 6, 8, 9, 10, 12, 'p12', 20, 21, 30, 40, 15, 36] as (number | string)[];
  const part = participacaoNosPisos(cards);
  const doc = document.createElement('div');
  doc.style.cssText = 'width:1280px;margin:0 auto;padding:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-items:start';
  for (const s of sel) {
    const base = cards[typeof s === 'number' ? s : Number(s.slice(1))];
    // 'pN' = 2ª aparição do mesmo item (patrocinada, outro preço): o bloco usa a ocorrência dela.
    const c: CardBusca = typeof s === 'number' ? base : { ...base, ocorrencias: [base.ocorrencias[1]], posicao: base.ocorrencias[1].posicao, preco: base.ocorrencias[1].preco, patrocinado: true };
    const el = document.createElement('div');
    el.className = 'poly-card';
    el.style.cssText = 'background:#fff;border-radius:6px;box-shadow:0 1px 2px #0003;overflow:hidden;padding-bottom:8px';
    const o = c.ocorrencias[0];
    el.innerHTML = `<img src="${c.miniaturaUrl}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;background:#f5f5f5;display:block">
      <div style="padding:10px 12px 0">
        ${c.patrocinado ? '<div style="font-size:11px;color:#999">Patrocinado</div>' : ''}
        <div class="qa-titulo" style="font-size:14px;margin:2px 0 6px"></div>
        <div class="poly-component__price"><div class="poly-price__current" style="display:flex;align-items:baseline;gap:6px">
          <span class="andes-money-amount" style="font-size:24px;color:#333"><span style="font-size:14px">R$ </span><span class="andes-money-amount__fraction">${precoNativo(o.preco).fraction}</span><sup class="andes-money-amount__cents" style="font-size:13px">${precoNativo(o.preco).cents}</sup></span>
          ${c.freteGratis ? '<span class="andes-money-amount__discount" style="font-size:12px;color:#00a650">5% OFF</span>' : ''}</div></div>
        <div style="font-size:12px;color:#00a650">${c.freteGratis ? 'Frete grátis' : ''} ${c.full ? '<b style="color:#00a650">⚡ FULL</b>' : ''}</div>
        <div style="font-size:12px;color:#777">${c.nota ? '★ ' + c.nota.toFixed(1) : ''} ${o.vendidosTexto ? '| ' + o.vendidosTexto : ''}</div>
        ${c.lojaOficial ? '<div style="font-size:12px;color:#3483fa">Loja oficial</div>' : ''}
      </div>`;
    (el.querySelector('.qa-titulo') as HTMLElement).textContent = c.titulo;
    const miolo = document.createElement('div');
    miolo.style.cssText = 'padding:0 12px';
    // Como o content script: frete só na aparição ao preço do card agregado; participação do conjunto inteiro (SW).
    const frete = c.preco === base.preco ? vistaDoFrete(c, c.preco, dados.enr) : null;
    const f = part.porItem[c.itemId];
    miolo.append(renderizarMiniBlocoDaBusca(c, meta[c.itemId], resultados[c.itemId], base.preco, vistaDoCard(c, dados.enr), AGORA_QA,
      { frete, participacao: dados.enr ? { fracao: f ?? null, cobertura: part.cobertura, grupos: part.grupos } : undefined }));
    el.append(miolo);
    doc.append(el);
  }
  raiz.append(doc);
}

if (q.get('vista') === 'grid') grade(); else painel();
