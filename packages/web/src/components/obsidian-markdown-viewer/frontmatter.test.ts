/**
 * Tests for frontmatter parsing utility
 * RED Phase: These tests should fail initially
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { parseFrontmatter, renderPropertyValue } from './frontmatter.tsx';

describe('parseFrontmatter', () => {
  it('should return empty frontmatter and original content when no frontmatter exists', () => {
    const content = '# Hello World\n\nThis is content.';
    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  it('should parse string values with quotes stripped', () => {
    const content = `---
title: "My Document Title"
description: 'Single quoted value'
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.title).toBe('My Document Title');
    expect(result.frontmatter.description).toBe('Single quoted value');
  });

  it('should parse string values without quotes', () => {
    const content = `---
author: John Doe
status: published
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.author).toBe('John Doe');
    expect(result.frontmatter.status).toBe('published');
  });

  it('should parse boolean values', () => {
    const content = `---
published: true
featured: false
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.published).toBe(true);
    expect(result.frontmatter.featured).toBe(false);
  });

  it('should parse integer values', () => {
    const content = `---
count: 42
priority: 1
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.count).toBe(42);
    expect(result.frontmatter.priority).toBe(1);
  });

  it('should parse float values', () => {
    const content = `---
rating: 4.5
price: 99.99
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.rating).toBe(4.5);
    expect(result.frontmatter.price).toBe(99.99);
  });

  it('should parse null values', () => {
    const content = `---
archived: null
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.archived).toBeNull();
  });

  it('should parse array values', () => {
    const content = `---
tags: [react, typescript, testing]
categories: ["frontend", "web"]
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.tags).toEqual(['react', 'typescript', 'testing']);
    expect(result.frontmatter.categories).toEqual(['frontend', 'web']);
  });

  it('should handle mixed value types', () => {
    const content = `---
title: "Test Document"
count: 10
published: true
tags: [a, b]
archived: null
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.title).toBe('Test Document');
    expect(result.frontmatter.count).toBe(10);
    expect(result.frontmatter.published).toBe(true);
    expect(result.frontmatter.tags).toEqual(['a', 'b']);
    expect(result.frontmatter.archived).toBeNull();
  });

  it('should extract body content after frontmatter', () => {
    const content = `---
title: Test
---
# Body Content

Some paragraph.`;
    const result = parseFrontmatter(content);

    expect(result.body).toBe('# Body Content\n\nSome paragraph.');
  });

  it('should handle empty frontmatter', () => {
    const content = `---
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('# Content');
  });

  it('should handle frontmatter-only content', () => {
    const content = `---
title: Test
---
`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.title).toBe('Test');
    expect(result.body).toBe('');
  });

  it('should handle malformed YAML gracefully (ignore unparseable lines)', () => {
    const content = `---
title: Valid
invalid line without colon
count: 42
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.title).toBe('Valid');
    expect(result.frontmatter.count).toBe(42);
  });

  it('should strip quotes from array items', () => {
    const content = `---
tags: ["react", "typescript", "testing"]
---
# Content`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.tags).toEqual(['react', 'typescript', 'testing']);
  });
});

describe('renderPropertyValue', () => {
  it('should return empty string for null or undefined', () => {
    expect(renderPropertyValue(null)).toBe('');
    expect(renderPropertyValue(undefined)).toBe('');
  });

  it('should return string value as-is', () => {
    expect(renderPropertyValue('Hello World')).toBe('Hello World');
  });

  it('should convert number to string', () => {
    expect(renderPropertyValue(42)).toBe('42');
    expect(renderPropertyValue(3.14)).toBe('3.14');
  });

  it('should convert boolean to string', () => {
    expect(renderPropertyValue(true)).toBe('true');
    expect(renderPropertyValue(false)).toBe('false');
  });

  it('should join array values with comma and space', () => {
    expect(renderPropertyValue(['a', 'b', 'c'])).toBe('a, b, c');
  });

  it('should render URLs as clickable links', () => {
    const result = renderPropertyValue('Visit https://example.com for more');
    // React 노드가 반환되므로 배열인지 확인
    expect(Array.isArray(result)).toBe(true);
    // 링크 요소가 존재하는지 확인
    const linkElement = (result as Array<React.ReactNode>).find(
      (item): item is React.ReactElement =>
        React.isValidElement(item) && item.type === 'a'
    );
    expect(linkElement).toBeDefined();
    if (React.isValidElement(linkElement)) {
      expect(linkElement.props).toMatchObject({
        href: 'https://example.com',
        target: '_blank',
        rel: 'noopener noreferrer',
      });
    }
  });

  it('should render multiple URLs as clickable links', () => {
    const result = renderPropertyValue('See https://example.com and http://test.org');
    expect(Array.isArray(result)).toBe(true);
    // 링크 요소들이 존재하는지 확인
    const links = (result as Array<React.ReactNode>).filter(
      (item): item is React.ReactElement =>
        React.isValidElement(item) && item.type === 'a'
    );
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle text without URLs', () => {
    const result = renderPropertyValue('Just plain text');
    expect(result).toBe('Just plain text');
  });

  it('should handle empty array', () => {
    expect(renderPropertyValue([])).toBe('');
  });
});
