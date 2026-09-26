export const COURSE_TITLE = 'Агентна інженерія';
export const COURSE_SUBTITLE = 'Стартовий шаблон';
export const TASK_HINT = 'Ваше завдання: додати ендпоінт /api/health';

export default function HomePage() {
  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 'clamp(1.75rem, 5vw, 3rem)', letterSpacing: '-0.02em' }}>
        {COURSE_TITLE}
      </h1>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: '1.1rem' }}>{COURSE_SUBTITLE}</p>
      <p
        style={{
          margin: '1rem 0 0',
          padding: '0.75rem 1.25rem',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          background: 'var(--panel)',
          color: 'var(--accent)',
        }}
      >
        {TASK_HINT}
      </p>
    </main>
  );
}
