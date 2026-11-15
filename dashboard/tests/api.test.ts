import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError, loadData, parseDocument } from '../src/api.ts';
import { loadFixture } from './helpers.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function failure(promise: Promise<unknown>): Promise<DataError> {
  try {
    await promise;
  } catch (error) {
    return error as DataError;
  }
  throw new Error('expected a rejection');
}

describe('parseDocument', () => {
  it.each(['normal', 'partial', 'failed', 'empty'] as const)('accepts the %s fixture', (name) => {
    expect(parseDocument(loadFixture(name)).schemaVersion).toBe(1);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'nope'],
    ['a newer schema', { ...loadFixture('normal'), schemaVersion: 2 }],
    ['a bad timestamp', { ...loadFixture('normal'), generatedAt: 'yesterday' }],
    ['missing events', { ...loadFixture('normal'), events: undefined }],
    ['missing pipeline checks', { ...loadFixture('normal'), pipeline: { runs: [], sources: [] } }],
  ])('rejects %s as a format error', (_label, value) => {
    expect(() => parseDocument(value)).toThrow(DataError);
    try {
      parseDocument(value);
    } catch (error) {
      expect((error as DataError).kind).toBe('format');
    }
  });
});

describe('loadData', () => {
  it('fetches data.json next to the page and parses it', async () => {
    const fetchMock = stubFetch(Response.json(loadFixture('normal')));
    const doc = await loadData(120_000);
    expect(doc.events.rows.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('./data.json?v=2', { cache: 'no-cache' });
  });

  it('reports a network failure when the request throws', async () => {
    stubFetch(new TypeError('offline'));
    expect((await failure(loadData())).kind).toBe('network');
  });

  it('reports a network failure for a non-2xx answer', async () => {
    stubFetch(new Response('gone', { status: 404 }));
    expect((await failure(loadData())).kind).toBe('network');
  });

  it('reports a format failure for a body that is not JSON', async () => {
    stubFetch(new Response('<html>', { status: 200 }));
    expect((await failure(loadData())).kind).toBe('format');
  });
});
