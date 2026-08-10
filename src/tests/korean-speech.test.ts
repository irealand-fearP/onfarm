/**
 * 숫자 낭독 규칙.
 *
 * 한국어 TTS 는 "1번"을 '한 번(once)'으로 읽는다. 번호를 부르는 자리에서는
 * 한자어 수사(일·이·삼)로, 개수를 세는 자리에서는 고유어 수사(한·두·세)로
 * 글자를 풀어서 넣어야 어르신이 듣고 바로 알아듣는다.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nativeCount, sinoNumber } from '../lib/korean.js';

describe('번호 낭독 — 한자어 수사', () => {
  it('한 자리 번호를 일·이·삼으로 읽는다', () => {
    assert.equal(sinoNumber(1), '일');
    assert.equal(sinoNumber(2), '이');
    assert.equal(sinoNumber(3), '삼');
    assert.equal(sinoNumber(9), '구');
  });

  it('십 단위를 올바르게 읽는다', () => {
    assert.equal(sinoNumber(10), '십');
    assert.equal(sinoNumber(12), '십이');
    assert.equal(sinoNumber(20), '이십');
    assert.equal(sinoNumber(35), '삼십오');
  });

  it('후보 문장이 "일번, 이번, 삼번" 으로 만들어진다', () => {
    const names = ['사과', '감귤', '양파'];
    const line = names.map((n, i) => `${sinoNumber(i + 1)}번 ${n}`).join(', ');
    assert.equal(line, '일번 사과, 이번 감귤, 삼번 양파');
    assert.ok(!/[0-9]번/.test(line), '낭독 문장에 아라비아 숫자가 남으면 안 된다');
  });
});

describe('개수 낭독 — 고유어 수사', () => {
  it('개수는 한·두·세로 읽는다(일·이·삼이 아니다)', () => {
    assert.equal(nativeCount(1), '한');
    assert.equal(nativeCount(3), '세');
    assert.equal(nativeCount(5), '다섯');
  });

  it('열·스무 단위를 올바르게 읽는다', () => {
    assert.equal(nativeCount(10), '열');
    assert.equal(nativeCount(12), '열두');
    assert.equal(nativeCount(20), '스무', '20 은 스물이 아니라 스무 상자다');
    assert.equal(nativeCount(21), '스물한');
  });

  it('수량 문장에 아라비아 숫자가 남지 않는다', () => {
    const line = `${nativeCount(3)} 상자`;
    assert.equal(line, '세 상자');
    assert.ok(!/[0-9]/.test(line));
  });

  it('범위 밖은 숫자 그대로 둔다(읽히긴 한다)', () => {
    assert.equal(nativeCount(0), '0');
    assert.equal(nativeCount(150), '150');
    assert.equal(sinoNumber(0), '0');
  });
});
