# Logo da organização na topbar — design

**Data:** 2026-11-15 · **Classificação:** crítica (migration + storage policy)

## Por quê
Cada cliente (org) quer ver a própria marca no app; hoje só aparece a marca PubliAI.

## Decisões (Diego + revisão Grok)
- **Posição:** desktop → esquerda da topbar, alinhada ao início do conteúdo. Mobile → no sheet do menu, faixa abaixo da marca PubliAI. Centro descartado (sem espaço no mobile, longe do título).
- **Duas versões opcionais:** `logo_claro_url` (para fundo claro) e `logo_escuro_url` (para fundo escuro). Usa a do tema ativo; se só houver uma, usa ela nos dois.
- **Tamanho:** `max-h-7 max-w-[140px] object-contain object-left`.
- **Nome da org:** só quando não há logo, ou quando a logo é símbolo (largura < 1,5× altura — chamada minha). Sem logo → iniciais num quadrado `h-7` + nome.
- `alt` = nome da org.

## Abordagens
1. **Duas versões opcionais (escolhida)** — sempre legível; um campo a mais.
2. Uma logo sobre plaquinha clara — pesa no tema escuro.
3. Uma logo sem tratamento — logo escura some no tema escuro.

## Como (chamadas minhas)
- **Banco:** colunas `logo_claro_url text`, `logo_escuro_url text` em `organizations`. Escrita pela policy existente `organizations: update admin`.
- **Storage:** bucket **público** `org-logos` (logo não é sensível; evita URL assinada expirando na topbar). `file_size_limit` 512 KB, `allowed_mime_types` png/jpeg/webp (sem SVG: SVG público pode carregar script). Escrita (insert/update/delete) só se `foldername[1] = current_org_id()` e `is_admin()`. Caminho `{org_id}/{claro|escuro}-{timestamp}.{ext}` (timestamp fura cache).
- **Upload:** Configurações → Geral → grupo "Identidade", 2 linhas (fundo claro / fundo escuro) com enviar e remover; editável só com `podeEditarEmpresa`.
- **Leitura:** hook `useOrgIdentidade` com `useOrgEfetivaId` (vale no modo suporte).

## Não-objetivos
Troca de org, co-branding, logo em e-mails/PDF, recorte ou edição de imagem, ADR novo (não muda arquitetura: coluna + bucket seguem padrões existentes).
