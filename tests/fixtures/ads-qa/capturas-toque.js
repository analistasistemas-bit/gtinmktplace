// Alvos de toque do /ads em retrato (360x800) e paisagem (800x360). Precisa de uma sessão com toque real, porque
// `pointer-coarse:` só liga com hasTouch:
//   echo '{"browser":{"contextOptions":{"hasTouch":true,"isMobile":true}}}' > /tmp/toque.json
//   playwright-cli -s=adsqa-toque open --config=/tmp/toque.json
//   (login, instalar-rotas.js e este arquivo, nessa ordem, na mesma sessão)
// Saída: prints fix2-p7-*.png e, por aba/viewport, a lista de controles com menos de 44 px (esperado: vazia).
async page => {
  const OUT = '/Users/diego/.claude/jobs/7b0b2175/tmp/qa/';
  const res = {};
  const pequenos = () => [...document.querySelectorAll('main button, main [role=tab], main [role=combobox], main input, main a')]
    .map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 34), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w > 0 && x.h < 43.5);
  res.coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  for (const [w, h] of [[360, 800], [800, 360]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const aba of ['desempenho', 'campanhas']) {
      await page.goto(`http://localhost:5173/#/ads?aba=${aba}`);
      await page.reload();
      await page.waitForTimeout(8000);
      await page.screenshot({ path: OUT + `fix2-p7-${aba}-${w}x${h}.png` });
      res[`pequenos_${aba}_${w}`] = await page.evaluate(pequenos);
    }
  }
  return JSON.stringify(res, null, 1);
}
