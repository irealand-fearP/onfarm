import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseKoreanQuantity, speakPrice, speakWeight } from '../lib/korean.js';

describe('음성 수량 인식', () => {
  it('고유어 수사를 읽는다', () => {
    assert.equal(parseKoreanQuantity('다섯 상자'), 5);
    assert.equal(parseKoreanQuantity('세 박스'), 3);
    assert.equal(parseKoreanQuantity('한 상자'), 1);
    assert.equal(parseKoreanQuantity('열 상자'), 10);
  });

  it('십단위 결합을 읽는다', () => {
    assert.equal(parseKoreanQuantity('열두 상자'), 12);
    assert.equal(parseKoreanQuantity('스물다섯 박스'), 25);
    assert.equal(parseKoreanQuantity('서른 개'), 30);
  });

  it('숫자가 섞여 오면 숫자를 우선한다', () => {
    assert.equal(parseKoreanQuantity('5상자'), 5);
    assert.equal(parseKoreanQuantity('12 박스요'), 12);
  });

  it('한자어 수사는 단위가 붙었을 때만 인정한다', () => {
    assert.equal(parseKoreanQuantity('삼 상자'), 3);
    assert.equal(parseKoreanQuantity('십오 개'), 15);
    assert.equal(parseKoreanQuantity('이'), null);
  });

  it('못 알아들으면 null 을 돌려 화면 조작으로 넘긴다', () => {
    assert.equal(parseKoreanQuantity(''), null);
    assert.equal(parseKoreanQuantity('그냥 많이요'), null);
  });

  it('범위를 벗어난 수량은 받지 않는다', () => {
    assert.equal(parseKoreanQuantity('1000상자'), null);
  });
});

describe('낭독 문자열', () => {
  it('만 단위로 자연스럽게 읽는다', () => {
    assert.equal(speakPrice(29000), '2만 9천 원');
    assert.equal(speakPrice(52000), '5만 2천 원');
    assert.equal(speakPrice(30000), '3만 원');
    assert.equal(speakPrice(9000), '9,000원');
  });

  it('무게 단위를 한글로 읽는다', () => {
    assert.equal(speakWeight(5, 'kg'), '5킬로그램');
  });
});
