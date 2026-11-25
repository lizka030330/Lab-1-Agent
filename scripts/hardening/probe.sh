#!/usr/bin/env bash
# Докази кроку 06 на ЗАДЕПЛОЄНОМУ застосунку (Лаб. 4).
#   bash scripts/hardening/probe.sh <мітка> [кількість запитів до моделі, типово 1]
# Мітки, які використано в hardening.md: baseline, flag-off, cap.
# Секрет обходу Vercel Authentication вводиться через read -s і НЕ пишеться ні у файл, ні в історію.
# Запити до моделі — лише текстове питання без файлу (найдешевший виклик), без озвучення.
set -uo pipefail
LABEL="${1:?мітка: baseline | flag-off | cap}"
N="${2:-1}"
BASE="${BASE_URL:-https://lab-1-agent-git-lab4-step-00-efremka.vercel.app}"
OUT="docs/lab4/traces/hardening/probe-${LABEL}.txt"
read -r -s -p "Секрет обходу Vercel (не показується): " BYPASS; echo
H=(-H "x-vercel-protection-bypass: ${BYPASS}")

field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j={};try{j=JSON.parse(s)}catch{console.log("НЕ JSON: "+s.slice(0,80).replace(/\s+/g," "));return}const pick=process.argv.slice(1);console.log(pick.map(k=>k+"="+JSON.stringify(k.split(".").reduce((o,p)=>o==null?undefined:o[p],j))).join("  "))})' "$@"; }

{
  echo "# Перевірка кроку 06 — ${LABEL}"
  echo "# час (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ) · URL: ${BASE} · локальний HEAD: $(git rev-parse --short HEAD)"
  echo
  echo "## GET /api/health"
  R="$(curl -sS "${H[@]}" -w '\n%{http_code}' "${BASE}/api/health")"
  echo "HTTP $(echo "${R}" | tail -1) · $(echo "${R}" | sed '$d' | field status commit)"
  echo
  echo "## GET /api/ready"
  R="$(curl -sS "${H[@]}" -w '\n%{http_code}' "${BASE}/api/ready")"
  echo "HTTP $(echo "${R}" | tail -1) · $(echo "${R}" | sed '$d' | field ok checks)"
  echo
  i=1
  while [ "${i}" -le "${N}" ]; do
    echo "## POST /api/multimodal #${i} (текстове питання, без файлу)"
    R="$(curl -sS "${H[@]}" -D /tmp/lab4-probe-h.txt -w '\n%{http_code}' -F "question=Скільки буде два плюс два? Відповідай одним числом." "${BASE}/api/multimodal")"
    RA="$(grep -i '^retry-after:' /tmp/lab4-probe-h.txt | tr -d '\r' | cut -d' ' -f2)"
    echo "HTTP $(echo "${R}" | tail -1)${RA:+ · Retry-After: ${RA}} · $(echo "${R}" | sed '$d' | field ok error reason answer inputTokens outputTokens task_id trace_id)"
    i=$((i + 1))
  done
} | tee "${OUT}"
rm -f /tmp/lab4-probe-h.txt
unset BYPASS
echo "Збережено: ${OUT}"
