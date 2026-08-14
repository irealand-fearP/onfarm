/**
 * 숫자 낭독 규칙.
 *
 * 한국어 TTS 는 "1번"을 '한 번(once)'으로 읽는다. 번호를 부르는 자리에서는
 * 한자어 수사(일·이·삼)로, 개수를 세는 자리에서는 고유어 수사(한·두·세)로
 * 글자를 풀어서 넣어야 어르신이 듣고 바로 알아듣는다.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nativeCount, parseKoreanQuantity, sinoNumber } from '../lib/korean.js';
import { describeListenOutcome } from '../lib/speech-feedback.js';

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

/*
 * 실제 STT(Web Speech API)가 뱉는 변형 입력.
 * 브라우저는 말 앞에 감탄사("어", "음")를 붙이거나 문장째 돌려주는 일이 잦은데,
 * 파서가 문장 맨 앞만 보고 있어 이런 입력을 통째로 놓쳤다.
 */
describe('음성 수량 인식 — STT 실제 변형 입력', () => {
  it('말 앞에 붙는 감탄사를 무시한다', () => {
    assert.equal(parseKoreanQuantity('아 다섯 상자'), 5);
    assert.equal(parseKoreanQuantity('음 세 박스요'), 3);
    assert.equal(parseKoreanQuantity('어 열두 상자'), 12);
  });

  it('앞말이 붙은 문장에서도 단위어 앞 수사를 찾아낸다', () => {
    assert.equal(parseKoreanQuantity('사과 다섯 상자 팔게요'), 5);
    assert.equal(parseKoreanQuantity('오늘은 스무 개만'), 20);
  });

  it('어르신이 쓰는 옛 수사(닷·엿)도 알아듣는다', () => {
    assert.equal(parseKoreanQuantity('닷 상자'), 5);
    assert.equal(parseKoreanQuantity('엿 상자'), 6);
  });

  it('수량이 아닌 말은 여전히 인식하지 않는다', () => {
    assert.equal(parseKoreanQuantity('너무 많이요'), null);
    assert.equal(parseKoreanQuantity('그냥 많이 주세요'), null);
    assert.equal(parseKoreanQuantity('네 알겠습니다'), null);
  });
});

describe('음성 인식 실패 안내 — 원인별로 다르게 말한다', () => {
  it('아예 못 들은 경우와 알아듣지 못한 경우를 구분한다', () => {
    const silent = describeListenOutcome({ status: 'no-speech' });
    const unparsed = describeListenOutcome({ status: 'unparsed', transcript: '많이요' });
    assert.notEqual(silent.message, unparsed.message);
    assert.ok(unparsed.message.includes('많이요'), '들린 말을 그대로 보여 줘야 한다');
  });

  it('마이크 권한 거부·미지원은 버튼 사용을 안내한다', () => {
    for (const status of ['not-allowed', 'unsupported'] as const) {
      const out = describeListenOutcome({ status });
      assert.equal(out.showManualFallback, true, `${status} 는 버튼 안내가 떠야 한다`);
    }
    assert.equal(describeListenOutcome({ status: 'no-speech' }).showManualFallback, false);
  });

  it('성공하면 수량을 그대로 돌려준다', () => {
    const out = describeListenOutcome({ status: 'ok', quantity: 5, transcript: '다섯 상자' });
    assert.equal(out.quantity, 5);
    assert.equal(out.ok, true);
  });

  it('알 수 없는 오류도 삼키지 않고 코드를 남긴다', () => {
    const out = describeListenOutcome({ status: 'error', errorCode: 'audio-capture' });
    assert.equal(out.ok, false);
    assert.ok(out.logLine.includes('audio-capture'));
  });
});
