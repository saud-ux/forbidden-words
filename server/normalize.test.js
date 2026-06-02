'use strict';
// Plain-node test suite for the Arabic detection logic. Run: `node server/normalize.test.js`
const assert = require('assert');
const {
  normalizeArabic, buildForbiddenSet, matchesForbidden,
  tokenizeCompleted, detectViolation, isCorrectGuess,
} = require('./normalize');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}
// Helper: detect against a fresh forbidden set built from the given words.
const detect = (text, words, roundEnd = false) =>
  detectViolation(text, buildForbiddenSet(words), roundEnd);

console.log('\nnormalizeArabic');
test('strips tashkeel + tatweel', () => assert.equal(normalizeArabic('كَــرّامة'), 'كرامه'));
test('alef variants → ا', () => {
  assert.equal(normalizeArabic('أسد'), 'اسد');
  assert.equal(normalizeArabic('إيمان'), 'ايمان');
  assert.equal(normalizeArabic('آمن'), 'امن');
});
test('ى → ي, ة → ه, ؤ → و, ئ → ي', () => {
  assert.equal(normalizeArabic('مصطفى'), 'مصطفي');
  assert.equal(normalizeArabic('كرة'), 'كره');
  assert.equal(normalizeArabic('مؤمن'), 'مومن');
  assert.equal(normalizeArabic('سائل'), 'سايل');
});
test('drops standalone hamza ء', () => assert.equal(normalizeArabic('ماء'), 'ما'));
test('folds Latin to lowercase', () => assert.equal(normalizeArabic('NBA'), 'nba'));
test('is idempotent', () => {
  const once = normalizeArabic('الأهرامات');
  assert.equal(normalizeArabic(once), once);
});
test('handles null/empty', () => {
  assert.equal(normalizeArabic(null), '');
  assert.equal(normalizeArabic('   '), '');
});

console.log('\ntokenizeCompleted');
test('drops the in-progress trailing token', () =>
  assert.deepEqual(tokenizeCompleted('يشبه كرا'), ['يشبه']));
test('keeps a token completed by a trailing space', () =>
  assert.deepEqual(tokenizeCompleted('يشبه كره '), ['يشبه', 'كره']));
test('keeps a token completed by punctuation', () =>
  assert.deepEqual(tokenizeCompleted('يشبه كره،'), ['يشبه', 'كره']));
test('roundEnd=true includes the final token', () =>
  assert.deepEqual(tokenizeCompleted('يشبه كره', true), ['يشبه', 'كره']));
test('handles empty text', () => assert.deepEqual(tokenizeCompleted(''), []));

console.log('\ndetectViolation — core behavior');
test('completed forbidden token IS flagged', () =>
  assert.equal(detect('نلعب في ملعب ', ['ملعب']), 'ملعب'));
test('in-progress forbidden token is NOT flagged (the كرامة/كرة case)', () =>
  assert.equal(detect('عنده كرا', ['كره']), null));
test('clean text returns null', () =>
  assert.equal(detect('شيء جميل وممتع ', ['ملعب']), null));
test('roundEnd flags the final uncompleted token', () =>
  assert.equal(detect('قال ملعب', ['ملعب'], true), 'ملعب'));

console.log('\ndetectViolation — prefix tolerance (input side)');
for (const [w, base] of [['والملعب', 'ملعب'], ['بالهدف', 'هدف'], ['فالكره', 'كره'],
                         ['كالاسد', 'اسد'], ['للاعب', 'لاعب'], ['الملعب', 'ملعب'],
                         ['وملعب', 'ملعب'], ['بملعب', 'ملعب']]) {
  test(`"${w}" flagged against [${base}]`, () =>
    assert.equal(detect(w + ' ', [base]), w));
}

console.log('\ndetectViolation — secret + forbidden both forbidden');
test('saying the secret word itself is a violation', () => {
  const set = buildForbiddenSet(['كرة القدم', 'ملعب', 'هدف', 'لاعب', 'حكم', 'كأس']);
  assert.ok(matchesForbidden(normalizeArabic('كره'), set));   // part of secret
  assert.ok(matchesForbidden(normalizeArabic('القدم'), set)); // part of secret
  assert.ok(matchesForbidden(normalizeArabic('كاس'), set));   // forbidden (كأس→كاس)
});

console.log('\ndetectViolation — multi-word answers (was a false-negative bug)');
test('leaking either word of "كرة القدم" is caught', () => {
  assert.equal(detect('هي كره ', ['كرة القدم']), 'كره');
  assert.equal(detect('هي القدم ', ['كرة القدم']), 'القدم');
});
test('bare stem "قدم" caught when answer word is "القدم"', () =>
  assert.equal(detect('على قدم ', ['كرة القدم']), 'قدم'));
test('"المدينة المنورة" — each word caught', () => {
  assert.equal(detect('زرت المدينه ', ['المدينة المنورة']), 'المدينه');
  assert.equal(detect('مكان منوره ', ['المدينة المنورة']), 'منوره');
});

console.log('\nNO false positives (was the fragment bug)');
test('"اعب" does NOT match forbidden "لاعب"', () =>
  assert.equal(detect('اعب ', ['لاعب']), null));
test('stripping ك off "كرة القدم" must NOT create fragment "ره"', () => {
  const set = buildForbiddenSet(['كرة القدم']);
  assert.ok(!set.has('ره القدم'), 'fragment "ره القدم" leaked into set');
  assert.equal(detect('ره ', ['كرة القدم']), null);
});
test('benign word sharing a root prefix is not flagged', () =>
  assert.equal(detect('كرامه ', ['كره']), null));

console.log('\nDocumented edge: "ماء" collapses to "ما" (spec-mandated drop of ء)');
test('common word "ما" trips when "ماء" is forbidden (known trade-off)', () =>
  assert.equal(detect('ما هذا ', ['ماء']), 'ما'));

console.log('\nisCorrectGuess — Arabic-aware, prefix-tolerant');
test('exact match wins', () => assert.ok(isCorrectGuess('أسد', 'أسد')));
test('diacritics/letter-form differences still match', () => {
  assert.ok(isCorrectGuess('اسد', 'أسد'));
  assert.ok(isCorrectGuess('كره', 'كرة'));
});
test('user-added prefix is tolerated', () => {
  assert.ok(isCorrectGuess('الأسد', 'أسد'));
  assert.ok(isCorrectGuess('والكرة', 'كرة'));
});
test('bare guess matches secret carrying ال', () =>
  assert.ok(isCorrectGuess('بتراء', 'البتراء')));
test('multi-word secret must match in full', () => {
  assert.ok(isCorrectGuess('كرة القدم', 'كرة القدم'));
  assert.ok(!isCorrectGuess('القدم', 'كرة القدم'), 'one word should NOT win');
  assert.ok(!isCorrectGuess('كرة', 'كرة القدم'), 'one word should NOT win');
});
test('wrong guess rejected', () => {
  assert.ok(!isCorrectGuess('قطة', 'أسد'));
  assert.ok(!isCorrectGuess('', 'أسد'));
});
test('does NOT accept a fragment of the secret (no letter-dropping)', () =>
  assert.ok(!isCorrectGuess('اعب', 'لاعب')));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
