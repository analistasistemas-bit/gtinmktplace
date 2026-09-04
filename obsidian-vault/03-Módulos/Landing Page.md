---
tags: [modulo, marketing, brand, standalone]
atualizado: 2026-09-02
---

# Landing Page

Artefato de marketing standalone em `docs/brand/`, não integrado ao app principal (`src/`).
Ver [[Marketplace]] para o módulo de produto real (distinto deste artefato de marketing).

**Status:** publicação em produção **a confirmar com o Diego** — não há evidência no repo
(sem config de deploy/hosting apontando para o caminho) de que esteja hospedada.

## O que é

Landing page de conversão do PubliAI — HTML standalone (single-file), CSS inline, sem build
step, tema dark roxo/violeta com hero + screenshot do dashboard, trust bar multicanal, "como
funciona" (4 passos), recursos, faixa multicanal e planos (placeholder). Headline: "Da planilha
ao anúncio publicado. Sem trabalho manual." Público-alvo: vendedores de marketplace.

## Onde vive no código

- `docs/brand/landing/index.html` — página completa, standalone.
- `docs/brand/landing/assets/dashboard.png` — screenshot do dashboard usado no hero.
- `docs/brand/landing/assets/favicon.svg`.
- Não faz parte do build do frontend principal (`src/`) — é um artefato isolado dentro de
  `docs/brand/`, não uma rota da SPA.

## De onde veio

- Spec/briefing original: `docs/brand/briefings-design.md`, seção **"5. LANDING PAGE / SITE
  (hero + seções)"** — define estrutura (hero, prova social, como funciona, features, diferencial
  multicanal, depoimentos placeholder, pricing placeholder, CTA final) e pede tema dark base
  (`#08090E`) com versão light.
- Implementação: commit `10c34c7d` ("feat(brand): landing page (HTML standalone)"), 28/06/2026.
- Ajustes posteriores: `1feab5f9` (fix de contraste no botão do header) e `059022a0` (atualização
  do screenshot do dashboard).

## Status real (não o desejado)

- Existe e está versionada no repo, mas **não há indício de hospedagem/publicação** — nenhum
  `vercel.json`/`netlify.toml`/config de deploy no repo referencia `docs/brand/landing`.
- Não integrada ao app principal — é um HTML isolado, não uma página servida pela SPA em `src/`.
- Confirmar com o Diego se há hosting fora do repo (ex.: domínio próprio, subdomínio) antes de
  assumir que está no ar.

---

Nota: `docs/brand/` também tem brand book, logo e briefings de outros ativos de marca/marketing
(ícones, ads, redes sociais) sem nota própria no vault ainda — gap fora do escopo desta nota.
