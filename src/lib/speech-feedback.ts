/**
 * 음성 수량 입력의 "실패 원인"을 사람 말로 바꿔 주는 순수 함수.
 *
 * Web Speech API 자체는 브라우저 기능이라 테스트할 수 없다. 그래서 결과 판정과
 * 안내 문구만 이 파일로 떼어내 서버 테스트에서 검증한다.
 * (예전에는 모든 실패가 똑같이 "잘 들리지 않았습니다" 로 뭉개져,
 *  마이크 권한 거부인지·말을 못 알아들은 것인지 아무도 구분하지 못했다.)
 */

/** 한 번 듣기의 결과 종류 */
export type ListenStatus =
  | 'ok' // 수량까지 알아들었다
  | 'unparsed' // 말은 들렸는데 수량으로 해석되지 않았다
  | 'no-speech' // 아무 말도 들리지 않았다
  | 'not-allowed' // 마이크 권한 거부(또는 HTTPS 아님)
  | 'network' // 인식 서버에 못 붙었다
  | 'aborted' // 도중에 취소됨
  | 'timeout' // 제한 시간 안에 말이 끝나지 않았다
  | 'unsupported' // 이 브라우저는 음성 인식을 지원하지 않는다
  | 'error'; // 그 밖의 오류

export interface ListenOutcome {
  status: ListenStatus;
  transcript?: string;
  quantity?: number | null;
  /** 브라우저가 준 원본 오류 코드(로그용) */
  errorCode?: string;
}

export interface ListenFeedback {
  ok: boolean;
  quantity: number | null;
  /** 화면에 띄울 안내 문구 */
  message: string;
  /** 수동(+/− 버튼) 안내를 함께 띄워야 하는가 */
  showManualFallback: boolean;
  /** 개발자 콘솔에 남길 한 줄 — 원인 추적용 */
  logLine: string;
}

/** 상태별 안내 문구. 어르신이 바로 다음 행동을 알 수 있게 쓴다. */
const MESSAGES: Record<Exclude<ListenStatus, 'ok' | 'unparsed'>, string> = {
  'no-speech': '말소리가 들리지 않았습니다. 버튼을 누르고 바로 말씀해 주세요.',
  'not-allowed': '마이크 사용이 막혀 있습니다. 아래 + − 버튼으로 수량을 골라 주세요.',
  network: '인터넷 연결이 불안정해 음성 인식을 못 했습니다. + − 버튼을 써 주세요.',
  aborted: '음성 입력이 중간에 멈췄습니다. 다시 눌러 주세요.',
  timeout: '시간이 지나 그만 들었습니다. 다시 눌러 말씀해 주세요.',
  unsupported: '이 브라우저는 음성 입력을 지원하지 않습니다. + − 버튼으로 골라 주세요.',
  error: '음성 입력에 문제가 있었습니다. + − 버튼으로 골라 주세요.',
};

/** 버튼 사용을 안내해야 하는(=다시 말해도 소용없는) 상태들 */
const MANUAL_FALLBACK: ReadonlySet<ListenStatus> = new Set<ListenStatus>([
  'not-allowed',
  'unsupported',
  'network',
  'error',
]);

export function describeListenOutcome(outcome: ListenOutcome): ListenFeedback {
  const { status, transcript = '', quantity = null, errorCode } = outcome;
  const detail = errorCode ? ` code=${errorCode}` : '';
  const heard = transcript ? ` heard="${transcript}"` : '';
  const logLine = `[음성수량] status=${status}${detail}${heard}`;

  if (status === 'ok' && quantity) {
    return { ok: true, quantity, message: '', showManualFallback: false, logLine };
  }

  if (status === 'unparsed') {
    // 들린 말을 그대로 보여 줘야 사용자가 무엇을 고쳐 말할지 안다.
    const message = transcript
      ? `"${transcript}" 를 수량으로 알아듣지 못했습니다. "다섯 상자" 처럼 말씀해 주세요.`
      : MESSAGES['no-speech'];
    return { ok: false, quantity: null, message, showManualFallback: false, logLine };
  }

  const known = status === 'ok' ? 'error' : status;
  return {
    ok: false,
    quantity: null,
    message: MESSAGES[known],
    showManualFallback: MANUAL_FALLBACK.has(known),
    logLine,
  };
}

/** 브라우저 SpeechRecognition 오류 코드 → 우리 상태값 */
export function statusFromErrorCode(code: string | undefined): ListenStatus {
  switch (code) {
    case 'no-speech':
      return 'no-speech';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not-allowed';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    default:
      return 'error';
  }
}
