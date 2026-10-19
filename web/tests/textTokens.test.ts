import { describe, expect, it } from 'vitest';
import { sentenceAt, tokenizeText } from '../src/lib/textTokens';

describe('tokenizeText (PRD §4.3)', () => {
  it('splits text into tokens and plain parts with correct offsets', () => {
    const text = 'The cat sat.';
    const parts = tokenizeText(text);
    expect(parts.map((p) => p.kind)).toEqual([
      'token', // The
      'plain',
      'token', // cat
      'plain',
      'token', // sat
      'plain',
    ]);
    for (const part of parts) {
      expect(text.slice(part.start, part.end)).toBe(part.text);
    }
  });

  it('keeps curly-apostrophe words as single tokens', () => {
    const parts = tokenizeText('don’t stop');
    expect(parts[0]).toMatchObject({ kind: 'token', text: 'don’t' });
  });

  it('keeps hyphenated words as single tokens', () => {
    const parts = tokenizeText('a well-known fact');
    const tokens = parts.filter((p) => p.kind === 'token').map((p) => p.text);
    expect(tokens).toContain('well-known');
  });

  it('preserves paragraphs and non-English text as plain parts', () => {
    const text = 'Hello world.\n\n中文注释 here.';
    const joined = tokenizeText(text)
      .map((p) => p.text)
      .join('');
    expect(joined).toBe(text);
  });
});

describe('sentenceAt (PRD §4.3)', () => {
  const text =
    'The study aims to elucidate the mechanism. It was well designed! What next? Final line without punctuation';

  it('finds the sentence containing an offset', () => {
    const offset = text.indexOf('elucidate');
    expect(sentenceAt(text, offset)).toBe(
      'The study aims to elucidate the mechanism.',
    );
    const offset2 = text.indexOf('designed');
    expect(sentenceAt(text, offset2)).toBe('It was well designed!');
    const offset3 = text.indexOf('next');
    expect(sentenceAt(text, offset3)).toBe('What next?');
    const offset4 = text.indexOf('Final');
    expect(sentenceAt(text, offset4)).toContain('Final line');
  });

  it('trims surrounding whitespace', () => {
    const text = 'First sentence here.   Second sentence follows.';
    const offset = text.indexOf('Second');
    expect(sentenceAt(text, offset)).toBe('Second sentence follows.');
  });
});
