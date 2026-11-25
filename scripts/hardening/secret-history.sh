#!/usr/bin/env bash
# Перевірка секретів в ІСТОРІЇ git (Лаб. 4, крок 06) — три команди з методички, bash-варіант.
# Запуск із кореня репозиторію:  bash scripts/hardening/secret-history.sh docs/lab4/traces/secret-history.txt
# Фрагменти ключів вводяться через read -s: не показуються на екрані, не пишуться у файл і в історію оболонки.
# У вивід іде лише МІТКА ключа (наприклад «gemini») і що знайдено.
set -uo pipefail
OUT="${1:-/dev/stdout}"
REPO_NAME="$(basename "$(git rev-parse --show-toplevel)")"
{
  echo "# Перевірка історії git на секрети — ${REPO_NAME}"
  echo "# дата: $(date -u +%Y-%m-%dT%H:%M:%SZ) · HEAD: $(git rev-parse --short HEAD) · гілок і тегів: $(git for-each-ref --format=x refs/heads refs/remotes refs/tags | wc -l | tr -d ' ') · коммітів у всіх гілках: $(git rev-list --all | wc -l | tr -d ' ')"
  echo
  echo '## 1. Чи існував колись файл із ключами (разом із видаленими)'
  echo '$ git log --all --full-history --name-only --date=short --format="%h %ad %s" -- ".env" ".env.*" "*.pem" "*.key"'
  git log --all --full-history --name-only --date=short --format="%h %ad %s" -- ".env" ".env.*" "*.pem" "*.key"
  echo "(кінець виводу; .env.example — шаблон без значень, очікувано)"
} > "${OUT}"

while true; do
  read -r -p "Мітка ключа (gemini, langfuse-sk, upstash, bypass…), порожньо — завершити: " LABEL
  [ -z "${LABEL}" ] && break
  read -r -s -p "Перші 8+ символів ключа «${LABEL}» (не показуються): " FRAG; echo
  if [ ${#FRAG} -lt 8 ]; then echo "Закоротко (${#FRAG}) — пропускаю."; continue; fi
  {
    echo
    echo "## 2. Фрагмент ключа «${LABEL}» (${#FRAG} симв.) у будь-якому комміті"
    echo '$ git log --all -p -S "<фрагмент>" --date=short --format="%h %ad %s"'
    HITS="$(git log --all -p -S "${FRAG}" --date=short --format="%h %ad %s" | grep -E '^[0-9a-f]{7,} [0-9]{4}-' || true)"
    if [ -z "${HITS}" ]; then echo "нічого не знайдено"; else echo "${HITS}"; fi
    echo
    echo "## 3. Ревізії, у дереві яких фрагмент «${LABEL}» лежить"
    echo '$ git rev-list --all | while read r; do git grep -l -F "<фрагмент>" "${r}"; done | sort -u'
    REVS="$(git rev-list --all | while read -r r; do git grep -l -F -- "${FRAG}" "${r}"; done | sort -u)"
    if [ -z "${REVS}" ]; then echo "нічого не знайдено"; else echo "${REVS}"; fi
  } >> "${OUT}"
  unset FRAG
done
echo "Готово: ${OUT}"
