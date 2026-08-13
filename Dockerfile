# ON-FARM 컨테이너 이미지
#
# Vercel 함수는 용량 한도(250MB) 때문에 onnxruntime-node(500MB)를 넣을 수 없어
# 배포본이 늘 색·질감 규칙 판정으로만 돌았다. 컨테이너로 옮기면 학습한 CNN 모델을
# 그대로 실어 보낼 수 있고, 데이터도 볼륨에 남아 콜드 스타트마다 사라지지 않는다.

FROM node:22-bookworm-slim

WORKDIR /app

# 의존성 먼저 — 소스만 바뀔 때 이 층을 다시 받지 않게 한다.
# Vercel과 달리 optional(onnxruntime-node)을 반드시 포함해야 CNN 이 뜬다.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional

COPY . .
RUN npm run build

# 시연 데이터는 볼륨에 둔다(이미지 안이 아니라). 재배포해도 주문·상품이 남는다.
ENV DATA_DIR=/data \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 3000

# server.js 가 시드 → AI provider 초기화 → 리슨까지 맡는다(Vercel 진입점과 동일).
CMD ["node", "server.js"]
