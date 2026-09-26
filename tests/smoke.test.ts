import { isValidElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import RootLayout, { metadata } from '../app/layout';
import HomePage, { COURSE_TITLE, COURSE_SUBTITLE, TASK_HINT } from '../app/page';

/** Рекурсивно збирає весь текст із дерева React-елементів. */
function collectText(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return collectText(props.children);
  }
  return [];
}

describe('app/page.tsx', () => {
  it('експортує компонент за замовчуванням, який повертає React-елемент', () => {
    expect(typeof HomePage).toBe('function');
    expect(isValidElement(HomePage())).toBe(true);
  });

  it('містить назву курсу, підпис і формулювання завдання', () => {
    const text = collectText(HomePage()).join(' ');

    expect(text).toContain(COURSE_TITLE);
    expect(text).toContain(COURSE_SUBTITLE);
    expect(text).toContain(TASK_HINT);
    expect(text).toContain('/api/health');
  });
});

describe('app/layout.tsx', () => {
  it('оголошує українську локаль і непорожній заголовок сторінки', () => {
    const tree = RootLayout({ children: null });
    const props = tree.props as { lang?: string };

    expect(props.lang).toBe('uk');
    expect(typeof metadata.title).toBe('string');
    expect(String(metadata.title).length).toBeGreaterThan(0);
  });
});
