import { describe, expect, it } from 'vitest';
import {
  normalizeSentence,
  normalizeTerm,
  displayTerm,
} from '../src/db/normalize';

describe('normalizeTerm (PRD §5.5)', () => {
  it('lowercases and trims', () => {
    expect(normalizeTerm('  Hello  ')).toBe('hello');
  });

  it('collapses consecutive whitespace', () => {
    expect(normalizeTerm('give\t  up')).toBe('give up');
  });

  it('normalizes curly apostrophes', () => {
    expect(normalizeTerm('don’t')).toBe("don't");
    expect(normalizeTerm('it’s')).toBe("it's");
  });

  it('does not stem word forms', () => {
    expect(normalizeTerm('running')).not.toBe(normalizeTerm('run'));
  });

  it('empty and whitespace-only input normalizes to empty', () => {
    expect(normalizeTerm('   ')).toBe('');
  });

  it('displayTerm keeps casing but normalizes whitespace', () => {
    expect(displayTerm('  NASA   mission ')).toBe('NASA mission');
  });
});

describe('normalizeSentence', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeSentence('  The study   aims to… ')).toBe(
      'The study aims to…',
    );
  });

  it('is NFC-normalized for Chinese', () => {
    const nfc = '词汇'.normalize('NFC');
    const nfd = '词汇'.normalize('NFD');
    expect(normalizeSentence(nfd)).toBe(normalizeSentence(nfc));
  });
});
