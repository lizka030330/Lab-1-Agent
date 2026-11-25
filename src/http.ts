/** Спільний помічник маршрутів (Лаб. 4, крок 06): у файлах маршрутів Next.js експортують ЛИШЕ обробники методів. */
export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
