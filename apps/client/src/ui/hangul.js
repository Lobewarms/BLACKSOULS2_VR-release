// Korean typed on the game's keyboard (ui.js KeyboardPanel - the chat's, in VR): 두벌식, as a Korean keyboard has it - each
// key a consonant or a vowel, put together into syllables as they come (ㅎ ㅏ ㄴ: 한). A consonant after a syllable with no
// final becomes its final (ㄱ ㅏ ㄱ: 각) and two that go together one final (ㄹ ㄱ: ㄺ); a vowel after a final takes it along
// into the next syllable (각 + ㅏ: 가가); two vowels that go together are one (ㅗ ㅏ: ㅘ). Back takes the last jamo off.

// the keys (the QWERTY letters as the game's keyboard has them) and their jamo - with shift: the doubled ones, ㅒ ㅖ
export const KO_KEYS = {
  q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
};
export const KO_SHIFT = { q: 'ㅃ', w: 'ㅉ', e: 'ㄸ', r: 'ㄲ', t: 'ㅆ', o: 'ㅒ', p: 'ㅖ' };

const CHO = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const JUNG = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const VOWEL_PAIRS = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
const FINAL_PAIRS = { 'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ' };
const split = pairs => Object.fromEntries(Object.entries(pairs).map(([two, one]) => [one, [...two]]));
const VOWEL_PARTS = split(VOWEL_PAIRS), FINAL_PARTS = split(FINAL_PAIRS);
const isVowel = j => JUNG.includes(j);

export class Hangul {
  constructor() { this.clear(); }
  clear() { this.cho = ''; this.jung = ''; this.jong = ''; }          // the syllable being typed, jamo by jamo
  get empty() { return !this.cho && !this.jung; }
  // the syllable so far, as it shows
  get text() {
    if (this.cho && this.jung) return String.fromCharCode(0xac00 + (CHO.indexOf(this.cho) * 21 + JUNG.indexOf(this.jung)) * 28 + JONG.indexOf(this.jong));
    return this.cho || this.jung;
  }
  // done with it: its text, the next jamo starting afresh
  flush() { const t = this.text; this.clear(); return t; }
  // one jamo in: the text it finished (to go before the syllable typed now), '' when it is still being put together
  put(j) {
    if (isVowel(j)) {
      if (this.jong) {
        // (its final, or the last of two, is the next syllable's first consonant)
        const parts = FINAL_PARTS[this.jong], next = parts ? parts[1] : this.jong;
        this.jong = parts ? parts[0] : '';
        const done = this.text;
        this.cho = next; this.jung = j; this.jong = '';
        return done;
      }
      if (this.jung) {
        const pair = VOWEL_PAIRS[this.jung + j];
        if (pair) { this.jung = pair; return ''; }
        const done = this.flush(); this.jung = j; return done;
      }
      this.jung = j;
      return '';
    }
    if (!CHO.includes(j)) { const done = this.flush(); return done + j; }
    if (this.cho && this.jung && !this.jong && JONG.includes(j)) { this.jong = j; return ''; }
    if (this.jong) {
      const pair = FINAL_PAIRS[this.jong + j];
      if (pair) { this.jong = pair; return ''; }
    }
    const done = this.flush();
    this.cho = j;
    return done;
  }
  // a jamo back: true when there was one to take off (none: the caller takes the letter before)
  back() {
    if (this.jong) { const p = FINAL_PARTS[this.jong]; this.jong = p ? p[0] : ''; return true; }
    if (this.jung) { const p = VOWEL_PARTS[this.jung]; this.jung = p ? p[0] : ''; return true; }
    if (this.cho) { this.cho = ''; return true; }
    return false;
  }
}
