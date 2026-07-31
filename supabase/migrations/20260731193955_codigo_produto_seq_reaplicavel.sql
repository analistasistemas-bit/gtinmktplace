-- Torna a inicialização de `organizations.produto_seq` reaplicável (spec 2026-07-31).
--
-- POR QUE ISTO EXISTE — não "simplifique" removendo o `o.produto_seq` do greatest():
--
-- A migration 20260731192443 inicializou a sequência atribuindo direto:
--
--   set produto_seq = greatest(max(codigo_pai), max(codigo))
--
-- Na primeira aplicação isso é inofensivo, porque a coluna nasce em 0. Reaplicado sobre uma
-- base que já reservou números, porém, aquilo REBOBINA: número reservado nem sempre vira
-- linha inserida — cadastro que falhou no meio, retry, ou estouro recusado por
-- `derivarCodigos` (D-5) queimam números sem deixar rastro em `familias`/`variacoes`. A
-- sequência voltaria para o maior código efetivamente gravado e reemitiria os queimados.
--
-- Sequência rebobinada é exatamente a falha que o guard `p_qtd <= 0` da RPC existe para
-- impedir, e aqui não há rede no banco: um índice único org-wide sobre os códigos é
-- impossível com os dados atuais (23 grupos duplicados de (org_id, codigo_pai) e 437 de
-- (org_id, codigo)).
--
-- A forma correta é a mesma que o ramo `p_resync` da RPC já usa — greatest() INCLUINDO o
-- valor corrente, um ratchet que só sobe. É esta:
update public.organizations o set produto_seq = greatest(
  o.produto_seq,
  coalesce((select max(f.codigo_pai::bigint) from public.familias f
            where f.org_id = o.id and f.codigo_pai ~ '^[0-9]{1,8}$'), 0),
  coalesce((select max(v.codigo::bigint) from public.variacoes v
            where v.org_id = o.id and v.codigo ~ '^[0-9]{1,8}$'), 0)
);
