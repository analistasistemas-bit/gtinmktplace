import {
  extrairEstadoOptin, montarPlanoAnuncio, montarUrlOptinUp, interpretarRespostaMatcher,
} from './lib/payload.js';

const ESPERA_ENTRE_ANUNCIOS_MS = 3000; // não martelar o ML

const resultados = []; // guardarResultado() empilha aqui; usado pelo rodapé e pelo "copiar relatório"
const resultadosEnvio = []; // resultado de cada enviarAnuncio(), também vai no "copiar relatório"

async function lerCtxDaAba(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    // Onde o estado SSR vive, verificado ao vivo em 2026-08-13 (MLB7066697288): a variável
    // global é `_n.ctx.r` — `window.__NORDIC_RENDERING_CTX__` NÃO existe como variável, é o
    // id do <script> que carrega `_n.ctx.r={...}`. Os três caminhos ficam por robustez:
    // variável (o que funciona hoje), global alternativa e, por último, parse do script.
    func: () => {
      const doScript = () => {
        const el = document.getElementById('__NORDIC_RENDERING_CTX__');
        const txt = el?.textContent ?? '';
        const i = txt.indexOf('_n.ctx.r=');
        if (i < 0) return null;
        try { return JSON.parse(txt.slice(i + '_n.ctx.r='.length)); } catch { return null; }
      };
      const ctx = window._n?.ctx?.r ?? window.__NORDIC_RENDERING_CTX__ ?? doScript();
      try { return ctx ? JSON.parse(JSON.stringify(ctx)) : null; } catch { return null; }
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

// --- Envio real (só sob confirmação explícita) --------------------------

// Injetada via executeScript — roda na página do ML, onde o navegador anexa cookies e o CSRF
// está na meta tag. NUNCA chamada sem confirmação explícita do operador.
function enviarNaPagina(url, metodo, body) {
  const token = document.querySelector('meta[name=csrf-token]')?.content ?? '';
  return fetch(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-csrf-token': token },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null) }));
}

async function executarEnvio(tabId, url, metodo, body) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: enviarNaPagina, args: [url, metodo, body],
  });
  return result;
}

async function enviarAnuncio(anuncio) {
  // Reabre e RELÊ: o estado do dry-run pode ter envelhecido.
  const { plano, basePath, tabId } = await dryRunAnuncio(anuncio);
  try {
    if (plano.tipo !== 'ok') return { anuncio, ok: false, etapa: 'releitura', motivo: plano.motivo };

    // Chamada 1: multivariation_matcher_confirm (PATCH)
    const urlMatcher = montarUrlOptinUp(basePath, anuncio.mlItemId, 'multivariation_matcher_confirm');
    const r1 = await executarEnvio(tabId, urlMatcher, 'PATCH', {
      productId: plano.productId,
      confirmedProductMatches: plano.confirmedProductMatches,
      flow: plano.flow,
    });
    if (r1.status === 403) return { anuncio, ok: false, etapa: 'matcher', status: 403, motivo: 'sessao_ml_caida_ou_csrf', corpo: r1.corpo };
    if (r1.status < 200 || r1.status >= 300) return { anuncio, ok: false, etapa: 'matcher', status: r1.status, corpo: r1.corpo };

    // Guard de eco + gates (invoice/anatel)
    const seguinte = interpretarRespostaMatcher(r1.corpo, plano);
    if (seguinte.acao !== 'summary') {
      return {
        anuncio, ok: false, etapa: 'pos-matcher', motivo: seguinte.motivo, corpo: r1.corpo,
        aviso: 'Wizard iniciado no servidor; terminar este anúncio MANUALMENTE na página do ML.',
      };
    }

    // Chamada 2: massive_summary_confirm (POST) — payload ECOADO da resposta 1
    const urlSummary = montarUrlOptinUp(basePath, anuncio.mlItemId, 'massive_summary_confirm');
    const r2 = await executarEnvio(tabId, urlSummary, 'POST', {
      parentProductId: seguinte.parentProductId,
      productAssociations: seguinte.productAssociations,
      flow: plano.flow,
      invoice: null,
    });
    if (r2.status < 200 || r2.status >= 300) {
      return {
        anuncio, ok: false, etapa: 'summary', status: r2.status, corpo: r2.corpo,
        aviso: 'Matcher confirmado mas summary falhou; terminar este anúncio MANUALMENTE na página do ML.',
      };
    }
    return { anuncio, ok: true, etapa: 'summary', status: r2.status, corpo: r2.corpo };
  } finally {
    if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
  }
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
      <td>—</td>
    `;
    corpo.appendChild(tr);
  }
}

function renderResultado(resultado) {
  const { corpo } = els();
  const tr = corpo.querySelector(`tr[data-ml-item-id="${cssEscape(resultado.anuncio.mlItemId)}"]`);
  if (!tr) return;
  const [, tdEstado, tdResumo, tdPayload, tdAcao] = tr.children;
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

  tdAcao.innerHTML = '';
  if (ok) {
    const botao = document.createElement('button');
    botao.textContent = 'Enviar este';
    botao.className = 'secundario';
    botao.addEventListener('click', () => enviarComConfirmacao([resultado.anuncio]));
    tdAcao.appendChild(botao);
  } else {
    tdAcao.textContent = '—';
  }
}

function renderResultadoEnvio(resultadoEnvio) {
  const { corpo } = els();
  const tr = corpo.querySelector(`tr[data-ml-item-id="${cssEscape(resultadoEnvio.anuncio.mlItemId)}"]`);
  if (!tr) return;
  const [, tdEstado, , , tdAcao] = tr.children;
  const tag = resultadoEnvio.ok ? 'tag-ok' : 'tag-manual';
  const rotulo = resultadoEnvio.ok ? 'enviado' : `erro (${escapeHtml(resultadoEnvio.etapa)})`;
  tdEstado.innerHTML = `<span class="tag ${tag}">${rotulo}</span>`
    + (resultadoEnvio.motivo ? `<br><small>${escapeHtml(resultadoEnvio.motivo)}</small>` : '')
    + (resultadoEnvio.aviso ? `<br><small><strong>${escapeHtml(resultadoEnvio.aviso)}</strong></small>` : '');
  tdAcao.innerHTML = '';
  tdAcao.textContent = resultadoEnvio.ok ? 'concluído' : '—';
}

function renderRodape() {
  const { rodape } = els();
  const ok = resultados.filter((r) => r.plano.tipo === 'ok').length;
  const manual = resultados.length - ok;
  rodape.hidden = false;
  rodape.textContent = `Dry-run concluído: ${ok} ok, ${manual} manual. NADA foi enviado ainda.`;
  const { enviarTodos } = els();
  enviarTodos.hidden = false;
  enviarTodos.disabled = ok === 0;
}

function guardarResultado(resultado) {
  resultados.push(resultado);
}

function mostrarInstrucaoFinal() {
  const { rodape } = els();
  rodape.hidden = false;
  rodape.textContent += ' No PubliAI, re-enfileire vincular-catalogo para as famílias deste lote '
    + '(scripts/backfill-catalogo-pendente.ts) — a tela Catálogo em risco só reflete o novo estado depois disso.';
}

// Só os anúncios com dry-run 'ok' desta sessão do painel — nunca envia sem dry-run prévio.
function candidatosOk(anuncios) {
  return anuncios
    .map((a) => resultados.find((r) => r.anuncio.mlItemId === a.mlItemId))
    .filter((r) => r && r.plano.tipo === 'ok');
}

async function enviarComConfirmacao(anuncios) {
  const candidatos = candidatosOk(anuncios);
  if (candidatos.length === 0) return;
  const totalNull = candidatos.reduce((s, r) => s + r.plano.resumo.null_enviados.length, 0);
  const totalPreservados = candidatos.reduce((s, r) => s + r.plano.resumo.preservados.length, 0);
  const confirmado = window.confirm(
    `${candidatos.length} anúncio(s), ${totalNull} variações vão receber "não encontro", `
    + `${totalPreservados} vínculos preservados. Enviar?`,
  );
  if (!confirmado) return;

  for (const r of candidatos) {
    const resultadoEnvio = await enviarAnuncio(r.anuncio);
    renderResultadoEnvio(resultadoEnvio);
    resultadosEnvio.push(resultadoEnvio);
    if (resultadoEnvio.motivo === 'sessao_ml_caida_ou_csrf') {
      window.alert('Sessão do ML caiu ou CSRF inválido. Faça login em mercadolivre.com.br e rode o dry-run de novo.');
      break; // interrompe o lote inteiro — não insistir em erro de sessão
    }
    await new Promise((res) => setTimeout(res, ESPERA_ENTRE_ANUNCIOS_MS));
  }
  mostrarInstrucaoFinal();
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
    navigator.clipboard.writeText(JSON.stringify({ dryRun: resultados, envios: resultadosEnvio }, null, 2));
  });

  document.querySelector('#enviar-todos-ok').addEventListener('click', () => enviarComConfirmacao(lote));

  document.querySelector('#rodar-dry-run').addEventListener('click', async () => {
    for (const anuncio of lote) {
      const resultado = await dryRunAnuncio(anuncio);
      renderResultado(resultado); // payload em <details>, contagens, motivo se manual
      if (resultado.tabId) await chrome.tabs.remove(resultado.tabId).catch(() => {});
      guardarResultado(resultado); // em memória, usado pelo envio (Task 4) e pelo relatório
      await new Promise((r) => setTimeout(r, ESPERA_ENTRE_ANUNCIOS_MS));
    }
    renderRodape(); // total ok / manual, aviso de que NADA foi enviado; habilita "Enviar todos os OK"
  });
}

main();
