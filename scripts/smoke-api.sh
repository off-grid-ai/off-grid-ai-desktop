#!/usr/bin/env bash
# Gateway API smoke test - exercises the on-device runtime paths that typecheck, unit
# tests, and the production build do NOT cover (they all passed while the app crashed on
# boot once). Run the app first (npm run dev, or a packaged build), then run this.
#
#   npm run dev          # in one terminal - wait for the model to come up
#   npm run smoke        # in another
#
# Override the target with OFFGRID_GATEWAY_URL. Set SMOKE_IMAGE=1 to include image gen
# (slower). Exits non-zero on the first failure so it works as a CI/pre-release gate.
set -uo pipefail
GW="${OFFGRID_GATEWAY_URL:-http://127.0.0.1:7878}"
fail() { echo "  FAIL: $1"; exit 1; }
ok() { echo "  ok: $1"; }

echo "[smoke] gateway = $GW"

# 0. Gateway reachable + model catalog (models-manager path)
curl -s -m 5 "$GW/v1/models" >/tmp/smoke_models.json 2>&1 || fail "gateway not reachable - start the app first (npm run dev)"
node -e 'const j=require("/tmp/smoke_models.json");if(!j.data||!j.data.length)process.exit(1);console.log("  models:",j.data.map(m=>m.id).join(", "))' \
  < /dev/null 2>/dev/null || fail "/v1/models returned no models"
ok "/v1/models"

# 1. Chat non-stream (model-server proxy + llm payload path)
C=$(curl -s -m 120 "$GW/v1/chat/completions" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Reply with exactly: PONG"}],"max_tokens":16,"stream":false}')
echo "$C" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.choices?.[0]?.message?.content)process.exit(1)})' || fail "chat non-stream returned no content"
ok "chat non-stream"

# 2. Chat stream (SSE proxy + retry refactor) - count content OR reasoning deltas
curl -sN -m 120 "$GW/v1/chat/completions" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Count one to five."}],"max_tokens":48,"stream":true}' > /tmp/smoke_stream.txt 2>&1
node -e 'const fs=require("fs");let n=0;for(const l of fs.readFileSync("/tmp/smoke_stream.txt","utf8").split("\n")){if(!l.startsWith("data:"))continue;const p=l.slice(5).trim();if(p==="[DONE]")continue;try{const d=JSON.parse(p).choices?.[0]?.delta||{};if(d.content||d.reasoning_content)n++;}catch(e){}}if(n<1)process.exit(1);console.log("  stream deltas:",n)' || fail "chat stream produced no deltas"
ok "chat stream"

# 3. Embeddings
curl -s -m 60 "$GW/v1/embeddings" -H 'Content-Type: application/json' -d '{"input":"hello world"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).data?.[0]?.embedding;if(!Array.isArray(v)||!v.length)process.exit(1);console.log("  dims:",v.length)})' || fail "embeddings returned no vector"
ok "embeddings"

# 4. Image generation (imagegen args/memory-guard/progress) - opt-in
if [ "${SMOKE_IMAGE:-0}" = "1" ]; then
  curl -s -m 240 "$GW/v1/images/generations" -H 'Content-Type: application/json' \
    -d '{"prompt":"a small red circle on white","size":"256x256","n":1}' \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data?.[0];if(!d||!(d.b64_json||d.url))process.exit(1);console.log("  image ok")})' || fail "image generation returned no image"
  ok "image generation"
else
  echo "  skip: image generation (set SMOKE_IMAGE=1 to include)"
fi

echo "[smoke] ALL PASSED"
