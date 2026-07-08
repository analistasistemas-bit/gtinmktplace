-- Re-âncora de preço no piso dos MercadoLíderes (ADR-0065).
-- Toggle por org: liga a regra que, no CREATE, quando o preço competitivo dá prejuízo real
-- (líquido Clássico < custo), re-ancora no menor preço entre os concorrentes MercadoLíder.
alter table configuracoes
  add column if not exists reancora_lider_ativa boolean not null default false;

-- Flag família-level: registra que o preço da família foi reancorado no piso dos líderes
-- (a decisão é da família, pelo pior caso de custo). Alimenta o selo distinto na Revisão.
alter table familias
  add column if not exists preco_reancorado_lider boolean not null default false;
