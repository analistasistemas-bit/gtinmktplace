import type { ReactNode } from 'react';

// Mesmos textos do dossiê (src/components/sku-dossie/ads-dossie.tsx).
export const AVISO: Partial<Record<string, string>> = {
  sem_coleta: 'A coleta de Ads começa após a ativação. Os valores aparecem aqui a partir do dia seguinte.',
  sem_permissao: 'O Mercado Livre recusou a leitura de Publicidade: sem permissão de Publicidade ou conexão recusada. Reconecte a conta em Canais; se continuar, confira a permissão “Publicidade” do aplicativo.',
  sem_advertiser: 'Esta conta não tem anunciante de Product Ads no Mercado Livre. Quem ativa é o vendedor, em Meu perfil → Publicidade.',
  sem_acesso: 'A conexão com o Mercado Livre foi recusada. Reconecte a conta em Canais.',
  coletando: 'Coletando os dados de Ads da conta…',
  sem_conexao: 'Conecte sua conta do Mercado Livre em Canais para ver as campanhas.',
};

/** Estado sem números: explicação e, quando houver, a única ação que resolve. */
export function Aviso({ texto, acao }: { texto: string; acao?: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      <p>{texto}</p>
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  );
}
