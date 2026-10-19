-- ADR-0187 Migration B: rede de segurança no banco — familias.ncm só aceita código da tabela oficial.
-- NOT VALID: vale para toda escrita nova; as linhas antigas (inclusive NCM fora da tabela) não são varridas
-- nem barradas — o Fiscal pendente cuida delas.
set local lock_timeout = '5s';
alter table public.familias
  add constraint familias_ncm_oficial_fk foreign key (ncm) references public.ncm_oficial(codigo) not valid;
