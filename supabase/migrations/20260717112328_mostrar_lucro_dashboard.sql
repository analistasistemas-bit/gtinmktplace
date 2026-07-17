-- Toggle por org: mostra (ou não) a linha "lucro R$ X" no card "Líquido no faturamento" do
-- Dashboard. Oculta por padrão — o lucro/margem continuam calculados normalmente em
-- cockpit.ts/resumo-vendas.ts, isto só afeta a exibição desse card.
alter table configuracoes
  add column if not exists mostrar_lucro_dashboard boolean not null default false;
