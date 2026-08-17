-- Pulse (ADR-0119, follow-up da Errata 3): respeitar `applicable_suggestion`.
--
-- `/suggestions/items/{id}/details` devolve, junto com a referência de preço, um campo dizendo se
-- ela **se aplica** àquele anúncio agora. A tela ignorava esse campo e exibia o selo ("Acima da
-- referência", "Abaixo da referência") em qualquer caso — ou seja, afirmava sobre o preço do
-- operador mais do que o próprio Mercado Livre afirma.
--
-- Isso importa porque o selo é lido como veredito: "Acima da referência" empurra para baixar preço.
-- Fazer isso com base numa referência que o ML marcou como não aplicável é decisão financeira
-- tomada sobre um número que a fonte não sustenta — o mesmo tipo de erro das Erratas 6 e 7, agora
-- na direção de afirmar demais em vez de calcular errado.
--
-- `true`  = o ML diz que a referência vale; a tela mostra o selo normalmente.
-- `false` = calculada mas não se aplica; a tela diz isso e não afirma posição de preço.
-- `null`  = a resposta não trouxe o campo. Tratado como "não sabemos", que NÃO é o mesmo que
--           "não se aplica": manter o comportamento atual é melhor do que esconder informação boa
--           por causa de uma leitura ausente.
alter table public.pulse_produtos
  add column if not exists ptw_aplicavel boolean;

comment on column public.pulse_produtos.ptw_aplicavel is
  '`applicable_suggestion` de /suggestions/items/{id}/details: o ML dizendo se a referência de preço se aplica a este anúncio. false = a tela não afirma posição de preço. null = campo ausente na leitura (mantém o comportamento anterior).';
