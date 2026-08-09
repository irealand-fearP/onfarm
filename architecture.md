# ON-FARM 아키텍처

## 설계 원칙

1. **AI가 실패해도 판매는 계속된다.** 모든 인식 실패는 "큰 버튼으로 직접 고르기"로 수렴한다.
2. **가격의 출처는 하나다.** AI도, 클라이언트도 가격을 만들지 못한다. `skus.price` 만이 유일한 출처다.
3. **참고 판정과 확정 판정을 분리한다.** AI의 `quality_hint` 와 거점의 `hub_inspections.graded_quality` 는 다른 컬럼이고 화면 문구도 다르다.
4. **시연은 네트워크에 목숨 걸지 않는다.** 외부 의존성 0(런타임), 내장 SQLite, 로컬 판정 폴백.

## AI 파이프라인

```
IMAGE (브라우저)
  │  features.js — 24칸 색상 히스토그램 · 채도² 가중 · 중심 가중 · 에지밀도
  ▼
/api/ai/analyze
  │
  ├─ ① product-recognition  ← VisionProvider (openai | anthropic | heuristic | mock)
  │     · 응답은 반드시 schema.ts 검증 통과 (카탈로그 밖 품목 거부, confidence 0..1 클램프)
  │     · primary 실패 → heuristic 폴백 → 그래도 실패 → unknown (사유는 항상 노출)
  ├─ ② quality-analysis     — 어두움/역광/저채도/배경혼재 감지 → '확인필요' 강등
  ├─ ③ sku-matcher          — 품목 코드 → 운영자 등록 표준 SKU 후보 (가격 유일 출처)
  ├─ ④ rule-engine          — auto(≥0.75 또는 격차≥0.25) / choose(≥0.45) / manual
  └─ ⑤ product-writer       — DB 값 + 사진 근거만으로 제목·소개문 생성 (없는 사실 금지)
  ▼
analysis-store (서버 메모리, 30분 TTL, 사용자 격리)
  │   등록 시 클라이언트 값을 믿지 않고 여기 저장된 결과로 재조립
  ▼
/api/farmer/listings → listings 테이블
```

### 왜 provider 추상화인가

`VisionProvider` 인터페이스(`analyzeProduct(input) → RecognitionResult`)만 지키면
OpenAI ↔ Claude ↔ 로컬 CV 모델을 코드 변경 없이 교체할 수 있다.
향후 AI 허브 '농산물 품질(QC) 이미지'로 학습한 모델이 이 자리에 들어온다 —
`heuristic.ts` 의 프로토타입 테이블이 정확히 그 교체 지점이다.

### 신뢰도 게이트 (rule-engine)

| 조건 | 모드 | 화면 |
|---|---|---|
| conf ≥ 0.75 | auto | "배로 보입니다" + [맞아요] |
| conf ≥ 0.5 그리고 2순위와 격차 ≥ 0.25 | auto | 〃 |
| conf ≥ 0.45 | choose | "배인지 양파인지 확실하지 않습니다" + 큰 버튼 2개 |
| 그 외 / SKU 없음 / 인식 실패 | manual | 전체 품목 큰 버튼 그리드 |

## 데이터 모델

```
users (farmer·consumer·hub_operator·admin)
  └─ farms ──── hub_id ──→ hubs (지역 집하·검수 거점)
products ─── skus (표준 판매단위·정찰가, 운영자 관리)
listings  ← 사진·AI분석원문(JSON)·참고판정·검수상태·재고
orders ─ order_items ─ settlements (수수료·지급예정)
hub_inspections (실물 검수 기록 — pass/downgrade/reject)
```

상태 흐름: `ai_checked → hub_pending(주문 발생 시) → hub_passed → ready_to_ship → delivered`
반려(reject) 시 `listings.status = closed` 로 매장에서 즉시 사라진다.

## 동시성·무결성

- **재고 차감**: `UPDATE ... WHERE remaining_quantity >= ?` 조건부 갱신 — 검사와 차감이 한 문장이라 동시 주문에도 초과판매 불가. CHECK 제약이 2차 방어.
- **주문**: 재고차감→주문→항목→정산을 `BEGIN IMMEDIATE` 트랜잭션으로 묶어 부분 성공 없음.
- **세션**: HMAC-SHA256 서명 쿠키. 위조 시 무효.
- **분석 결과**: 서버 메모리에 사용자별 격리 저장. 타인의 analysisId 로 등록 시도 → 410.
- **가격**: 등록 API가 `unitPrice` 를 받아도 무시하고 SKU 테이블 값으로 강제.

## 기술 스택 선택 이유

| 선택 | 이유 |
|---|---|
| Node 24 내장 `node:sqlite` | 런타임 의존성 0 → 심사장 네트워크·클라우드 장애와 무관하게 시연 가능 |
| 의존성 없는 HTTP 서버 | 취약점 표면 최소화, 설치 1~2분, 이해하기 쉬운 코드 |
| TypeScript strict | 스키마 계약(AI 응답)을 타입으로 고정 |
| 정적 HTML + ES 모듈 | 빌드 파이프라인 없이 브라우저 직행, PWA 캐시 용이 |
| 서버·브라우저 공용 모듈 | 한국어 수사 파서를 `/js/shared/` 로 서빙 — 한 벌만 테스트 |

## Phase 2+ 확장 자리 (구조만 준비됨)

- **수산물**: `products.category = 'seafood'` + `active=0` 시드(전복). 냉장·선도 워크플로는 별도 컬럼 추가로 확장.
- **CV 모델**: `VisionProvider` 구현 하나 추가로 끝. 학습 데이터 후보 = AI 허브 농산물 QC 이미지.
- **거점 물류 최적화·수요예측**: 주문/정산 데이터가 이미 정규화되어 쌓인다.
- **결제**: `orders.status = 'paid'` 를 만드는 지점에 PG 연동 삽입.
