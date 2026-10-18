import test from 'node:test';
import assert from 'node:assert/strict';

const keys = {
  pcMenu: '클릭 / ↑↓: 선택 · Enter: 결정 · Esc: 뒤로',
  vrMenu: '스틱: 선택 · A / 트리거: 결정 · B: 뒤로',
  pcMap: 'N: 지도 · Tab: 메뉴',
  vrMap: 'Y: 메뉴 → 지도',
  pcClose: '닫기: N / Esc',
  vrClose: '닫기: B / Y',
};

test('launcher languages translate separate PC and VR controls without mixing the input modes', async t => {
  const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => {
    if (location) Object.defineProperty(globalThis, 'location', location); else delete globalThis.location;
    if (navigator) Object.defineProperty(globalThis, 'navigator', navigator); else delete globalThis.navigator;
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN' } });
  const localizedWords = {
    ko: ['클릭', '스틱', '지도', '메뉴', '닫기'],
    en: ['Click', 'Stick', 'Map', 'Menu', 'Close'],
    ja: ['クリック', 'スティック', 'マップ', 'メニュー', '閉じる'],
    zh: ['点击', '摇杆', '地图', '菜单', '关闭'],
  };
  for (const [language, [click, stick, map, menu, close]] of Object.entries(localizedWords)) {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?lang=' + language } });
    const { tr, lang } = await import(`../src/ui/i18n.js?control-hints=${language}`);
    assert.equal(lang(), language, 'the launcher language must override the browser language');
    const hints = Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, tr(key)]));
    assert.ok(hints.pcMenu.includes(click) && hints.pcMenu.includes('↑↓') && hints.pcMenu.includes('Enter') && hints.pcMenu.includes('Esc'));
    assert.ok(hints.vrMenu.includes(stick) && /\bA\b/.test(hints.vrMenu) && /\bB\b/.test(hints.vrMenu));
    assert.ok(hints.pcMap.includes(map) && hints.pcMap.includes(menu) && hints.pcMap.includes('Tab') && /\bN\b/.test(hints.pcMap));
    assert.ok(hints.vrMap.includes(map) && hints.vrMap.includes(menu) && hints.vrMap.includes('→') && /\bY\b/.test(hints.vrMap));
    assert.ok(hints.pcClose.includes(close) && /N \/ Esc/.test(hints.pcClose));
    assert.ok(hints.vrClose.includes(close) && /B \/ Y/.test(hints.vrClose));
    for (const hint of [hints.pcMenu, hints.pcMap, hints.pcClose]) assert.doesNotMatch(hint, /\b(?:A|B|Y|trigger|Stick)\b|스틱|트리거|スティック|トリガー|摇杆|扳机/iu);
    for (const hint of [hints.vrMenu, hints.vrMap, hints.vrClose]) assert.doesNotMatch(hint, /\b(?:N|Tab|Enter|Esc|Click)\b|클릭|クリック|点击/iu);
    if (language === 'en') assert.deepEqual(Object.values(hints), [
      'Click / ↑↓: Select · Enter: Confirm · Esc: Back',
      'Stick: Select · A / trigger: Confirm · B: Back',
      'N: Map · Tab: Menu', 'Y: Menu → Map', 'Close: N / Esc', 'Close: B / Y',
    ]);
  }
});
