# ON-FARM (온팜)

**고령 농어민을 위한 AI 초간편 직거래 판매 플랫폼 — MVP**

> 기존 이커머스는 판매자가 디지털을 사용할 수 있다는 것을 전제로 한다.
> ON-FARM은 그 전제를 없앤다.
> 농어민에게 남는 것은 단 두 가지 — **"사진 찍고, 수량 확인하면 끝."**

```
수확 → 사진 찍기 → (AI가 품목·판매단위·소개문 자동) → 수량 확인 → 판매 시작
```

## 빠른 시작

가장 쉬운 방법: **`_시작하기.bat` 더블클릭** → 브라우저가 `/demo` 로 열립니다.

수동 실행:

```bash
npm install
npm run seed     # DB 생성 + 데모 데이터
npm run dev      # 빌드 + 서버 시작 (기본 http://127.0.0.1:4173)
```

| 주소 | 화면 |
|---|---|
| `/demo` | **시연 시작점** — 세 화면으로 가는 역할 전환 버튼 + 데이터 초기화 |
| `/about` | **서비스 소개** — 팀·심사 공유용 한 장 문서 |
| `/seller` | 판매자(농어민) 화면 — 큰 버튼·음성 안내. 하위: `/seller/sell`(사진 등록), `/seller/orders`(주문), `/seller/products`(내 상품), `/seller/money`(받을 돈) |
| `/shop` | 소비자 매장 (`/` 도 같은 화면). 하위: `/shop/product`, `/shop/cart`, `/shop/orders` |
| `/hub` | 거점/관리자 대시보드 |
| `/login` | 데모 계정 선택 (역할별로 묶여 있음) |

옛 주소 `/farmer`·`/store` 는 각각 `/seller`·`/shop` 으로 **301 리다이렉트**됩니다.
판매자 화면은 경로(`/seller`)뿐 아니라 **`seller.` 로 시작하는 호스트**로도 열립니다
(예: `seller.example.com/` → 판매자 홈). 도메인 없이 시연할 때는 경로만 쓰면 됩니다.

### 판매자 화면의 두 가지 장치

- **로그인 없이 바로 사진 버튼** — `DEMO_AUTO_LOGIN=true`(기본)이면 `/seller` 에 세션 없이 들어와도
  기본 농민 계정으로 자동 로그인해 계정 선택 화면을 건너뜁니다. 소비자·거점 화면에는 적용되지 않습니다.
- **밀도 토글(`가⁻`/`가⁺`)** — 판매자 화면 우측 상단 버튼 1탭으로 글자·버튼 크기를 `크게 ↔ 보통` 전환합니다.
  기본값은 **크게**이며 선택은 브라우저에 기억됩니다(`onfarm.seller.density`).
  디자인을 두 벌 만들지 않고 `seller.css` 의 기준 단위 `--u` 하나만 바꾸는 방식입니다.

요구사항: **Node.js 22.5+** (내장 `node:sqlite` 사용). 외부 DB·클라우드 불필요.

## 공개 시연 배포

Vercel CLI가 연결된 환경에서는 다음 명령으로 공개 시연본을 배포할 수 있습니다.

```bash
vercel --prod
```

Vercel 함수의 로컬 파일시스템은 영구 저장소가 아닙니다. 따라서 이 배포는 시연용으로,
SQLite 데이터와 업로드 사진이 콜드 스타트 또는 인스턴스 교체 시 초기화될 수 있습니다.
실제 운영 환경에서는 외부 영구 DB와 파일 스토리지를 연결해야 합니다.

## 환경변수

`.env.example` 을 `.env` 로 복사해서 사용합니다. **아무것도 설정하지 않아도 동작합니다.**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` / `HOST` | `4173` / `127.0.0.1` | 서버 주소 |
| `AI_PROVIDER` | `heuristic` | `heuristic` \| `openai` \| `anthropic` \| `mock` |
| `OPENAI_API_KEY` 등 | — | 외부 Vision 사용 시에만 |
| `AI_TIMEOUT_MS` | `12000` | 외부 API 타임아웃. 초과 시 로컬 판정으로 자동 폴백 |
| `DATA_DIR` | `./data` | DB·업로드 사진 저장 위치 |
| `SESSION_SECRET` | (개발값) | 운영 시 반드시 변경 |
| `DEMO_AUTO_LOGIN` | `true` | `/seller` 진입 시 기본 농민 계정 자동 로그인. `false` 면 로그인 화면으로 |

### AI provider 동작 방식

- **heuristic (기본)** — 브라우저가 사진에서 색·질감 특징(24칸 색상 히스토그램, 채도, 명도, 에지밀도)을 뽑고, 서버가 품목 프로토타입과 대조해 후보를 만듭니다. **사진이 외부로 전송되지 않으며**, 화면에도 "로컬 색·질감 규칙 판정"으로 표기됩니다. 딥러닝 모델이 아니며 신뢰도 상한을 0.86으로 잠가 과신을 막습니다.
- **openai / anthropic** — 이미지 입력 모델로 인식. 응답은 스키마 검증을 통과해야 하며, **카탈로그에 없는 품목·임의 가격은 거부**됩니다. 실패하면 자동으로 heuristic 폴백.
- **mock** — 시연 고정 응답(항상 배 0.91). 화면 상단에 **"데모 모드" 배지가 강제 표시**됩니다.

## 테스트

```bash
npm test
```

140개 테스트: AI 응답 스키마 검증 / SKU 매칭 / 룰 엔진 / 재고 차감(초과판매 방지) /
주문 트랜잭션 롤백 / 역할별 접근 제어 / AI 실패 폴백 / HTTP 종단(사진→주문→검수) / 음성 수량 파서 /
판매자·소비자 사이트 분리(호스트 판정·옛 주소 301).

## 프로젝트 구조

```
src/
  ai/            # 파이프라인: 인식 → 품질신호 → SKU매칭 → 룰엔진 → 문안작성
    providers/   # heuristic · openai · anthropic · mock (VisionProvider 인터페이스)
  db/            # node:sqlite + schema.sql + seed
  domain/        # listings · orders · settlements · inspections · users
  server/        # 의존성 0 HTTP 서버 + 라우트
  lib/           # 세션, 이미지, 한국어 수사 파서(서버·브라우저 공용)
  tests/
public/
  seller/        # 판매자 화면 3개 (index · sell · todo)
  shop/          # 소비자 화면 (product · cart · orders, 목록은 public/index.html)
  hub/           # 거점 작업대
  demo.html      # 시연 시작점 · login.html 계정 선택
  css/           # base(토큰) + seller · shop · hub · entry(데모·로그인)
```

색은 전부 `css/base.css` 의 토큰만 거쳐 씁니다. 라이트/다크가 여기서 한 번에 결정되며,
역할별 스타일시트는 서로 참조하지 않아 한 화면을 고쳐도 다른 역할이 깨지지 않습니다.

상세 설계는 [architecture.md](architecture.md), 구현 현황은 [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md),
시연 대본은 [COMPETITION_DEMO.md](COMPETITION_DEMO.md) 참고.

## 정직성 원칙 (화면 문구에 그대로 반영됨)

- AI는 등급을 **확정하지 않습니다** → 항상 "AI 품질 참고 판정". 확정 등급은 거점 실물 검수.
- AI는 가격을 **만들지 않습니다** → 가격은 운영자가 등록한 표준 SKU에서만 나옵니다.
- AI는 식품 안전성을 **검사하지 않습니다** → 화면에 명시.
- 데모/폴백 상태를 **숨기지 않습니다** → mock 사용 시 배지, 외부 API 실패 시 강등 사유 표시.
- 수수료 8%는 **시연용 가정값**입니다 → 정산 화면에 명시.
