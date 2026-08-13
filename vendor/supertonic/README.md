# Supertonic 음성 합성 — 들여온 코드

`helper.js` 는 [supertone-inc/supertonic](https://github.com/supertone-inc/supertonic) 의
`nodejs/helper.js` 를 **고치지 않고 그대로** 복사한 것이다(MIT, `LICENSE` 동봉).
고치지 않는 이유는 원본이 갱신됐을 때 그대로 덮어쓸 수 있게 하기 위해서다.

의존성은 `onnxruntime-node` 하나뿐이다(원본 package.json 의 `fft.js`·`js-yaml` 은
이 파일에서 쓰이지 않는다 — import 목록으로 확인).

## 모델 자산은 여기에 없다

`assets/onnx/*` 와 `assets/voice_styles/F1.json` 은 합계 약 380MB 라 저장소에 넣지 않는다.
`scripts/fetch-tts-assets.mjs` 가 Hugging Face(`Supertone/supertonic-3`)에서 받아
`vendor/supertonic/assets/` 에 놓는다. Dockerfile 이 이미지 빌드 때 이 스크립트를 부른다.

자산이 없으면 서버는 TTS 를 끄고 뜨며, 화면은 브라우저 내장 음성으로 내려앉는다.

모델 라이선스는 코드와 다르다 — **OpenRAIL-M**(상업 이용 가능, 사용 제한 조항 있음).
