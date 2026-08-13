import { extrairEstadoOptin, montarPlanoAnuncio, montarUrlOptinUp, interpretarRespostaMatcher } from './lib/payload.js';

const ESPERA_ENTRE_ANUNCIOS_MS = 3000; // não martelar o ML

const resultados = []; // guardarResultado() empilha aqui; usado pelo rodapé e pelo "copiar relatório"

async function lerCtxDaAba(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const ctx = window.__NORDIC_RENDERING_CTX__ ?? null;
      try { return JSON.parse(JSON.stringify(ctx)); } catch { return null; }
    },
  });
  return result;
}

async function abrirEAguardar(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await new Promise((resolve) => {
    let resolvido = false;
    const finalizar = () => {
      if (resolvido) return;
      resolvido = true;
      chrome.tabs.onUpdated.removeListener(ouvinte);
      resolve();
    };
    const ouvinte = (id, info) => { if (id === tab.id && info.status === 'complete') finalizar(); };
    chrome.tabs.onUpdated.addListener(ouvinte);
    // ponytail: guarda contra corrida — a aba pode já estar 'complete' antes do listener ser
    // anexado (tabs.create resolve depois da criação, não da navegação); sem isso a promise
    // nunca resolve e o lote trava. Upgrade se aparecer outra corrida: usar webNavigation.
    chrome.tabs.get(tab.id, (atual) => { if (atual?.status === 'complete') finalizar(); });
  });
  return tab;
}

export async function dryRunAnuncio(anuncio) {
  const tab = await abrirEAguardar(anuncio.url); // a MESMA url do card (produzir/catalogo/<item>)
  try {
    const ctx = await lerCtxDaAba(tab.id);
    const estado = extrairEstadoOptin(ctx);
    const plano = montarPlanoAnuncio(estado, anuncio.variacoesRisco, anuncio.vinculos);
    const basePath = estadoBasePath(estado, anuncio.url);
    return { anuncio, plano, basePath, step: estado?.step ?? null, tabId: tab.id };
  } catch (erro) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    return { anuncio, plano: { tipo: 'manual', motivo: `erro_leitura:${String(erro)}` }, tabId: null };
  }
}

function estadoBasePath(estado, urlAnuncio) {
  // basePath vem do contexto SSR quando existe; senão deriva do caminho conhecido da página.
  return estado?.contextData?.basePath ?? new URL(urlAnuncio).pathname.replace(/\/MLB\d+.*/, '');
}

// --- Render DOM puro ---------------------------------------------------

function els() {
  return {
    vazio: document.querySelector('#vazio'),
    tabela: document.querySelector('#tabela-lote'),
    corpo: document.querySelector('#corpo-tabela'),
    rodar: document.querySelector('#rodar-dry-run'),
    enviarTodos: document.querySelector('#enviar-todos-ok'),
    copiar: document.querySelector('#copiar-relatorio'),
    rodape: document.querySelector('#rodape'),
  };
}

function renderVazio() {
  const { vazio } = els();
  vazio.hidden = false;
}

function renderLote(lote) {
  const { tabela, corpo, rodar, copiar } = els();
  tabela.hidden = false;
  rodar.hidden = false;
  copiar.hidden = false;
  corpo.innerHTML = '';
  for (const anuncio of lote) {
    const tr = document.createElement('tr');
    tr.dataset.mlItemId = anuncio.mlItemId;
    tr.innerHTML = `
      <td>${escapeHtml(anuncio.titulo)}<br><small>${escapeHtml(anuncio.mlItemId)}</small></td>
      <td><span class="tag tag-pendente">pendente</span></td>
      <td>—</td>
      <td>—</td>
    `;
    corpo.appendChild(tr);
  }
}

function renderResultado(resultado) {
  const { corpo } = els();
  const tr = corpo.querySelector(`tr[data-ml-item-id="${cssEscape(resultado.anuncio.mlItemId)}"]`);
  if (!tr) return;
  const [, tdEstado, tdResumo, tdPayload] = tr.children;
  const ok = resultado.plano.tipo === 'ok';
  tdEstado.innerHTML = `<span class="tag ${ok ? 'tag-ok' : 'tag-manual'}">${ok ? 'ok' : 'manual'}</span>`
    + (ok ? '' : `<br><small>${escapeHtml(resultado.plano.motivo)}</small>`)
    + (resultado.step ? `<br><small>step: ${escapeHtml(String(resultado.step))}</small>` : '');
  // Resumo pode faltar (a função pura retorna cedo em vários motivos de "manual"); guard aqui.
  const resumo = resultado.plano.resumo ?? { null_enviados: [], preservados: [], excluidos_por_status: [], risco_ausente: [] };
  tdResumo.innerHTML = `
    null: ${resumo.null_enviados.length} · preservados: ${resumo.preservados.length}
    · excluídos: ${resumo.excluidos_por_status.length} · risco ausente: ${resumo.risco_ausente.length}
  `;
  const detalhes = document.createElement('details');
  detalhes.innerHTML = `<summary>payload</summary><pre>${escapeHtml(JSON.stringify(resultado.plano, null, 2))}</pre>`;
  tdPayload.innerHTML = '';
  tdPayload.appendChild(detalhes);
}

function renderRodape() {
  const { rodape } = els();
  const ok = resultados.filter((r) => r.plano.tipo === 'ok').length;
  const manual = resultados.length - ok;
  rodape.hidden = false;
  rodape.textContent = `Dry-run concluído: ${ok} ok, ${manual} manual. NADA foi enviado ainda.`;
}

function guardarResultado(resultado) {
  resultados.push(resultado);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

async function main() {
  const { lote } = await chrome.storage.session.get('lote');
  if (!Array.isArray(lote) || lote.length === 0) { renderVazio(); return; }
  renderLote(lote); // tabela inicial, tudo "pendente"

  document.querySelector('#copiar-relatorio').addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(resultados, null, 2));
  });

  document.querySelector('#rodar-dry-run').addEventListener('click', async () => {
    for (const anuncio of lote) {
      const resultado = await dryRunAnuncio(anuncio);
      renderResultado(resultado); // payload em <details>, contagens, motivo se manual
      if (resultado.tabId) await chrome.tabs.remove(resultado.tabId).catch(() => {});
      guardarResultado(resultado); // em memória, para a Task 4 usar no envio
      await new Promise((r) => setTimeout(r, ESPERA_ENTRE_ANUNCIOS_MS));
    }
    renderRodape(); // total ok / manual, aviso de que NADA foi enviado
  });
}

main();
