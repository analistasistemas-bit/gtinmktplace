// Service worker da Extensão PubliAI (ADR-0189 D-4/D-14, emenda 2026-10-24). Único contexto que toca
// chrome.storage.session e as credenciais (storage.local); content scripts e painel falam com ele por mensagem.
import { protegerCredenciais } from './credenciais';
import { ajustarPainelDaAba, esquecerAba, esquecerEstado, painelSoNoMl } from './abas';
import { aoAtualizarAba, rotearMensagem } from './roteador';
import { apagarSessaoLegada, receberMensagemExterna } from './sessao';

// Antes de tudo: storage.local só para contextos confiáveis (por padrão, content scripts leem). Toda gravação de
// token também chama protegerCredenciais antes e não grava se falhar.
protegerCredenciais().catch(() => {});
// Sessão empurrada pelo app na 0.2.x: apagada, nunca vira credencial nem é revogada. Sem alarme de expiração:
// a sessão própria dura até "Sair" (ou refresh recusado), renovada sob demanda.
void apagarSessaoLegada().catch(() => {});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
void painelSoNoMl().catch(() => {});

// 0.3.0: mensagens do app web não trazem mais sessão (ignoradas em receberMensagemExterna).
chrome.runtime.onMessageExternal.addListener((msg, sender, responder) => {
  receberMensagemExterna(msg, sender).then(responder, () => responder({ ok: false }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  const r = rotearMensagem(msg, sender);
  if (!r) return false;
  r.then(responder, () => responder({ ok: false, erro: 'interno' }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'loading') void ajustarPainelDaAba(tabId, tab.url).catch(() => {});
  void aoAtualizarAba(tabId, info);
});
chrome.tabs.onRemoved.addListener((tabId) => { esquecerAba(tabId); esquecerEstado(tabId); });
