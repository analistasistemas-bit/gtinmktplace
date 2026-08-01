-- Faixa alta reservada para o código gerado na Avil (decisão do Diego, 2026-07-31).
--
-- Na Avil, `99xxxxxx` passa a significar "código gerado pelo PubliAI", visivelmente separado da
-- numeração que o ERP dela produz (maior código do ERP hoje: 31.327.733). Além da leitura a
-- olho, isso afasta o risco de o ERP crescer até alcançar a numeração gerada — os dois deixam
-- de disputar o mesmo espaço.
--
-- ESCOPO: ajuste PONTUAL desta organização. Não é regra geral — não generalizar para outras
-- orgs, não transformar em piso padrão, não criar coluna de configuração para isto. A DSA
-- continua em 1 (primeiro código gerado `00000002`) de propósito.
--
-- `greatest` pelo mesmo motivo do 20260731193955: mantém a migration reaplicável e incapaz de
-- ABAIXAR a sequência, que é o modo de falha que vira colisão silenciosa depois.
update public.organizations
  set produto_seq = greatest(produto_seq, 99000000)
  where id = 'a72ea303-5559-4a35-9aff-daa12cd1de12';
