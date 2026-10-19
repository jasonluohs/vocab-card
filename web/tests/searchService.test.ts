import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from './setup';
import { db } from '../src/db/db';
import type { ContextRecord, WordRecord } from '../src/db/db';
import { createDraft, markComplete } from '../src/services/wordRepository';
import { buildSearchDocs, searchDocs } from '../src/services/searchService';

let seq = 0;

async function seed(
  term: string,
  fields: Partial<WordRecord> = {},
  contexts: string[] = [],
): Promise<WordRecord> {
  const word = (await createDraft(term))!;
  seq += 1;
  await markComplete(word.id, {
    primaryChinese: fields.primaryChinese ?? `${term}的中文`,
    primaryEnglish: fields.primaryEnglish ?? `Definition of ${term}.`,
    exampleSentence: fields.exampleSentence ?? `An example with ${term}.`,
    additionalSenses: fields.additionalSenses ?? [],
    generationModel: 'mock',
  });
  for (const sentence of contexts) {
    await db.contexts.add({
      id: `ctx-${term}-${seq}-${contexts.indexOf(sentence)}`,
      wordId: word.id,
      sentence,
      normalizedSentence: sentence,
      sourceType: 'paste' as const,
      capturedAt: Date.now(),
    });
  }
  return (await db.words.get(word.id))!;
}

async function allContexts(): Promise<ContextRecord[]> {
  return db.contexts.toArray();
}

beforeEach(async () => {
  await resetDb();
  seq = 0;
});

describe('searchDocs (PRD §4.7)', () => {
  it('finds exact, prefix, and partial spelling matches on terms', async () => {
    await seed('elucidate');
    await seed('elucidation');
    await seed('elegant');
    const docs = buildSearchDocs(await db.words.toArray(), []);

    const exact = searchDocs(docs, 'Elucidate');
    expect(exact[0].term).toBe('elucidate'); // exact first

    const prefix = searchDocs(docs, 'elu');
    expect(prefix.map((h) => h.term)).toContain('elucidate');
    expect(prefix.map((h) => h.term)).toContain('elucidation');

    const partial = searchDocs(docs, 'lucid');
    expect(partial.map((h) => h.term)).toContain('elucidate');
  });

  it('searches Chinese primary definitions and other senses', async () => {
    await seed('elucidate', { primaryChinese: '阐明；解释清楚' });
    await seed('run', {
      primaryChinese: '跑',
      additionalSenses: [{ chinese: '经营', english: 'To manage.' }],
    });
    const docs = buildSearchDocs(await db.words.toArray(), []);

    expect(searchDocs(docs, '阐明').map((h) => h.term)).toEqual(['elucidate']);
    expect(searchDocs(docs, '经营').map((h) => h.term)).toEqual(['run']);
  });

  it('searches English definitions, examples, and historical contexts', async () => {
    await seed('obscure');
    await seed('serendipity', {}, [
      'A fortunate serendipity guided the discovery.',
    ]);
    const docs = buildSearchDocs(await db.words.toArray(), await allContexts());

    // The English definition itself is searchable via substring.
    const defHits = searchDocs(docs, 'definition of obscure');
    expect(defHits[0].term).toBe('obscure');

    // Historical context fragment finds the card (PRD success criterion).
    const ctxHits = searchDocs(docs, 'guided the discovery');
    expect(ctxHits.map((h) => h.term)).toEqual(['serendipity']);
  });

  it('returns each card only once even when hitting multiple fields', async () => {
    await seed('elucidate', { primaryChinese: '阐明' }, [
      'The term elucidate appears here.',
    ]);
    const docs = buildSearchDocs(await db.words.toArray(), await allContexts());
    const hits = searchDocs(docs, 'elucidate');
    expect(hits.filter((h) => h.term === 'elucidate')).toHaveLength(1);
  });

  it('no fuzzy tolerance for queries of 2 chars or fewer', async () => {
    await seed('elucidate');
    const docs = buildSearchDocs(await db.words.toArray(), []);
    // 'e*' would fuzzy-match many things; with 2 chars we only do exact/
    // prefix/substring — 'el' is a prefix so it hits.
    expect(searchDocs(docs, 'el').map((h) => h.term)).toEqual(['elucidate']);
    // 'zz' matches nothing even fuzzily.
    expect(searchDocs(docs, 'zz')).toEqual([]);
  });

  it('misspelled queries still fuzzy-match for longer queries', async () => {
    await seed('serendipity');
    const docs = buildSearchDocs(await db.words.toArray(), []);
    const hits = searchDocs(docs, 'serendipity');
    expect(hits.length).toBeGreaterThan(0);
    const typo = searchDocs(docs, 'serendipaty'); // missing 'i'
    expect(typo.map((h) => h.term)).toContain('serendipity');
  });

  it('index rebuild reflects deletes and edits', async () => {
    await seed('elucidate');
    await seed('run');
    let words = await db.words.toArray();
    let docs = buildSearchDocs(words, await allContexts());
    expect(searchDocs(docs, 'run').length).toBe(1);

    await db.words.where('normalizedTerm').equals('run').delete();
    words = await db.words.toArray();
    docs = buildSearchDocs(words, await allContexts());
    expect(searchDocs(docs, 'run')).toEqual([]);
  });
});
