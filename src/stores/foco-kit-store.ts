import { create } from 'zustand';

// ADR-0200 (adendo 08/11): depois de criar, montar mais ou desmontar, o diálogo fecha e Publicados leva o operador à
// linha da base (expande e destaca "Kits com variação"). Store em vez de prop: o diálogo de criar só avisa no
// `onSuccess` da mutation, e Publicados decide como chegar à linha (página, busca ou o Gerenciar kit).
interface FocoKit {
  alvo: { codigoPaiBase: string; kitId?: string; seq: number } | null;
  focar: (codigoPaiBase: string, kitId?: string) => void;
  limpar: () => void;
}

export const useFocoKitStore = create<FocoKit>((set) => ({
  alvo: null,
  focar: (codigoPaiBase, kitId) => set({ alvo: { codigoPaiBase, kitId, seq: Date.now() } }),
  limpar: () => set({ alvo: null }),
}));
