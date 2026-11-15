// "Atualizar agora" do selo de versão (ADR-0153 D4). O updateSW do vite-plugin-pwa só recarrega
// se a página já nasceu controlada pelo service worker (workbox-window: isUpdate =
// Boolean(controller) no register). Aba aberta com recarga forçada (Cmd+Shift+R) não tem
// controller: o clique ativava a versão nova sem recarregar, e o 2º clique não achava mais
// versão esperando — "nada acontece". Aqui o próprio clique garante a recarga.
export async function atualizarApp(
  sw: ServiceWorkerContainer | undefined = navigator.serviceWorker,
  recarregar: () => void = () => window.location.reload(),
): Promise<void> {
  const waiting = (await sw?.getRegistration())?.waiting;
  if (!sw || !waiting) {
    recarregar();
    return;
  }
  let feito = false;
  const umaVez = () => {
    if (feito) return;
    feito = true;
    recarregar();
  };
  sw.addEventListener('controllerchange', umaVez);
  // ponytail: se a versão nova não assumir em 3 s, recarrega mesmo assim (pior caso: abre a velha).
  window.setTimeout(umaVez, 3000);
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
