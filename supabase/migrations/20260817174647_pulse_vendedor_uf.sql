-- Pulse (ADR-0119): UF de onde o concorrente envia.
--
-- Pedido do operador: saber o estado do vendedor concorrente. Serve para julgar vantagem de frete e
-- prazo — um rival em SP entrega no Sudeste mais rápido e mais barato que um do Nordeste, e isso
-- muda a leitura de "ele está R$ 2 mais barato".
--
-- Vem de `address.state` da mesma resposta de `/users/{id}` que já buscamos para reputação e
-- volume, então não custa chamada nova. Guardada como sigla de 2 letras (o ML devolve `BR-SP`);
-- nome por extenso é descartado em vez de gravado — uma coluna com "São Paulo" numa linha e "SP"
-- na outra não dá para comparar de bater o olho.
--
-- Fica no snapshot por dia (mesma granularidade de nickname/reputação) e não numa tabela de
-- vendedor: o endereço pode mudar, e o histórico já é o modelo desta tabela.
alter table public.pulse_vendedores
  add column if not exists uf text;

comment on column public.pulse_vendedores.uf is
  'Sigla do estado de onde o vendedor envia (`address.state` de /users/{id}, sem o prefixo BR-). null = o ML não expôs o endereço nessa leitura. Entra em deveGravarVendedor para o backfill acontecer sem depender de mudança de volume.';
