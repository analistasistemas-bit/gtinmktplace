# Pacote do contador: compras (ADR-0181, Plano 2b-1) — design

**Data:** 2026-10-16 · **ADR:** [0181](../../decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md) (D-13, parte "compras")
**Base:** Plano 2a em produção (`docs/superpowers/specs/2026-10-16-pacote-contador-vendas-design.md`) — card "Pacote do contador" em `/estoque`.
**Fora deste plano:** inventário (D-12) → Plano 2b-2.

## Objetivo

O mesmo `pacote-AAAA-MM.zip` do 2a passa a levar também as **compras do mês**: os XMLs das notas de compra importadas
no PubliAI + `relatorio-compras.xlsx` e `relatorio-compras.pdf` (uma linha por item).

**Sucesso:** um arquivo por mês com vendas e compras; uma falha do Mercado Livre não impede o contador de receber as compras.

## Decisões do Diego (2026-10-16)

1. **Competência = data de emissão** da nota de compra (`dhEmi` do XML, America/Sao_Paulo). A planilha mostra também a data de importação.
2. **Mesmo pacote** das vendas. Falha do ML (429, trava local, 5xx, sem conexão/permissão, resposta ambígua) → o pacote sai com as
   compras e "Vendas indisponíveis: <motivo> — gere o pacote de novo depois". Só sessão expirada e organização trocada abortam tudo.
3. **Uma linha por item**, com o cabeçalho da nota repetido, **incluindo CSOSN/CST** do fornecedor (lido do XML).

## Fontes e fluxo (abordagem A — tudo no navegador, XML como fonte)

Sem edge nova, sem migration, sem chamada ao ML para compras. As policies existentes já dão leitura por org:
`notas_compra_select`, `notas_compra_itens_select` e `notas_compra_xml_select` (bucket privado `notas-compra`, path
`${orgId}/${chave}/${sha256}.xml`), em `supabase/migrations/20261015231837_adr181_nota_compra.sql`.

```
card (mês) ──▶ em paralelo:
  vendas : baixarNotasMes (2a, inalterado na edge)   → zip | vazio | indisponível(motivo)
  compras: listarNotasCompraMes(mes)                 → notas_compra da org com emitida_em no mês (SP), todas as situações
           por nota 'importada': baixarXml(xml_path) → confere sha256 = xml_sha256 → lerCompra(xml)
  relatorio-compras.xlsx/pdf (+ relatório de vendas do 2a) → pacote-AAAA-MM.zip
```

Estrutura do zip:
```
relatorio-vendas.xlsx · relatorio-vendas.pdf          (2a)
relatorio-compras.xlsx · relatorio-compras.pdf        (novo)
xmls/<caminho do ML>…                                  (2a, vendas — inalterado)
compras/xmls/<chave>.xml                               (novo; só notas 'importada' com XML íntegro)
```

### Unidades

| Unidade | Faz |
|---|---|
| `src/lib/pacote-contador/compras-fonte.ts` | `listarNotasCompraMes(mes)`: `notas_compra` da org (filtro explícito por `effectiveOrgId()`, além da RLS) com `emitida_em` ≥ dia 1 00:00 e < dia 1 do mês seguinte, ambos em America/Sao_Paulo; `baixarXmlCompra(nota)`: `storage.download` + sha256 (Web Crypto) comparado a `xml_sha256` |
| `src/lib/pacote-contador/compras-ler.ts` | `lerCompra(xml)`: `lerNfe` + CSOSN/CST por item; `montarCompras(notas, xmls)` → linhas por item, totais por nota/mês, conferência (puro) |
| `supabase/functions/_shared/nfe/ler-nfe.ts` + `tipos.ts` | campo novo opcional `ItemNotaLido.csosn: string \| null` (CSOSN no Simples, CST no regime normal; o que vier no grupo ICMS). Aditivo: a importação ignora o campo. Mudança em `_shared/` → **redeploy de `importar-nota-compra`** (e de quem mais importar `ler-nfe.ts`) |
| `src/lib/pacote-contador/relatorio-compras-xlsx.ts` / `-pdf.ts` | abas "Compras" + "Conferência de compras"; PDF paisagem com a mesma tabela + página de conferência |
| `src/lib/pacote-contador/montar.ts` | aceita as compras (pasta `compras/xmls/` + 2 relatórios) além das vendas |
| `src/lib/pacote-contador/baixar.ts` | troca de organização passa a lançar **`ErroOrgMudou`** (classe própria); hoje ela sai como `ErroPacote` 409, igual a "conta não autorizou", e o card não distingue |
| card `card-pacote-contador.tsx` | roda vendas e compras em paralelo; classifica a falha de vendas (abaixo); `conferir()` (abort + org) antes de montar, como no 2a |

## Relatório de compras

**Aba "Compras"** — uma linha por item, ordem: `dhEmi` (instante), número, `nItem`.

| Bloco | Colunas |
|---|---|
| Nota | Data de emissão (America/Sao_Paulo) · Data de importação · Fornecedor · CNPJ · Número · Série · Chave |
| Item | Nº item · Código do fornecedor (`cProd`) · Descrição (`xProd`) · NCM · CFOP · CSOSN/CST · Quantidade (`qCom`) · Unidade (`uCom`) |
| Valores do item (do XML, sem rateio) | Produtos · Frete · Seguro · Desconto · Outras · IPI · ST |

- Chave, número, série, NCM, CFOP, CSOSN/CST e CNPJ como **texto**. Dinheiro em **centavos inteiros** internamente, exibido com 2 casas (`#,##0.00` em toda coluna de dinheiro). Quantidade com até 4 casas (`#,##0.####`).
- **Totais por nota:** chave · número · fornecedor · total da nota (`vNF`). **Total do mês** = soma dos `vNF` das notas listadas.

**Aba "Conferência de compras"** (no PDF: página própria): org, CNPJ (de `empresa_fiscal`, buscado na hora como no 2a), mês,
data/hora da geração; nº de notas importadas e de itens; notas **desfeitas** e **canceladas** do mês (situação + data, fora da
planilha e sem XML no zip); notas **cópia sem assinatura digital** (`assinada = false`); XML **indisponível** ou **diferente do
importado** (sha256) → selo **PACOTE PARCIAL**; aviso fixo `Compras pela data de emissão; só notas importadas no PubliAI.`;
`Nenhuma nota de compra no mês` quando a lista vier vazia.

O relatório de vendas do 2a ganha, quando a parte de vendas falhar, a linha `Vendas indisponíveis: <motivo> — gere o pacote de novo depois.` na sua Conferência, e o pacote não leva `xmls/` de vendas.

## Falha de vendas × aborto

| Falha | Resultado |
|---|---|
| `ErroPacote` 429 (ML ou trava local), 409 (sem conexão / sem permissão), 502 (indisponível / ambíguo), `ErroDownloadIncompleto` | pacote com compras + "Vendas indisponíveis: <mensagem>" |
| `ErroPacote` 401 (sessão), `ErroOrgMudou`, `AbortError` | aborta tudo (como hoje) |
| falha ao **listar** as compras (`notas_compra`) | aborta tudo com mensagem — sem fonte alternativa |
| um XML de compra que não baixa / sha256 divergente | só aquela nota vai para a Conferência; PARCIAL |

O toast final diz o que saiu: "Pacote de AAAA-MM gerado", "… gerado como PARCIAL" ou "… gerado sem as vendas (<motivo>)".

## Testes

1. `lerCompra`: CSOSN (Simples, ex.: 102) e CST (regime normal, ex.: 00) por item; nota com 2 itens; fixtures sintéticas com CNPJs `11222333000181`/`11444777000161`.
2. `montarCompras`: ordem (emissão, número, item), centavos exatos, totais por nota e do mês, desfeita/cancelada só na Conferência, `assinada=false` sinalizada, XML ausente e sha256 divergente → PARCIAL, mês vazio.
3. `listarNotasCompraMes`: limites do mês em America/Sao_Paulo (nota de 30/09 23:30−03:00 é setembro; de 01/10 00:10−03:00 é outubro).
4. `baixarXmlCompra`: sha256 confere / diverge (Web Crypto no jsdom).
5. xlsx relido com SheetJS (chave texto, formatos de dinheiro e quantidade, totais) e PDF (`output()` com Conferência e selo).
6. `montarPacote`: as duas pastas e os 4 relatórios; sem vendas quando indisponível.
7. Card: vendas 429 → pacote sai com compras e toast "sem as vendas"; `ErroOrgMudou` aborta; abort no unmount não salva.
8. `lerNfe`: testes existentes da importação continuam verdes (campo aditivo).

**Runtime:** org de teste descartável + conta VALIDATION (procedimento do Plano 1): importar uma nota de teste, gerar o
pacote do mês da emissão, conferir as linhas contra o XML, e limpar tudo depois (dados, bucket, perfil restaurado).

## Pendências

- Inventário (Plano 2b-2): custo médio ponderado móvel com unidades sem nota (planilha/cadastro) e ausência de separação Full no banco.
