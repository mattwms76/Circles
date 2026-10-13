import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, demo, deferred, mountApp } from './react-fixture.mjs';

for (const kind of ['Circles', 'People'])
  test(`Old ${kind.toLowerCase()} pagination cannot overwrite a newer search's error or loading state`, async (t) => {
    const old = deferred(),
      next = deferred();
    let pages = 0;
    const results = {
      circles: Array.from({ length: 30 }, (_, i) => ({ ...demo.circles[0], id: `circle-${i}` })),
      people: Array.from({ length: 20 }, (_, i) => ({ ...demo.people[0], id: `person-${i}` })),
    };
    const app = await mountApp({
      community: {
        searchDiscovery: async (_q, _f, co, po) => {
          if (co || po) return ++pages === 1 ? old.promise : next.promise;
          return results;
        },
      },
    });
    t.after(() => app.close());
    await act(async () => app.props('TabBar').onChange('circles'));
    await act(async () => new Promise((r) => setTimeout(r, 330)));
    let first;
    await act(async () => {
      first = app.props('ExploreScreen')[`onLoadMore${kind}`]();
    });
    assert.equal(pages, 1);
    await act(async () => app.props('ExploreScreen').onSearch('new search'));
    await act(async () => new Promise((r) => setTimeout(r, 330)));
    assert.equal(
      app.props('ExploreScreen')[`${kind.toLowerCase()}LoadingMore`],
      false,
      'New searches must release old pagination state',
    );
    let second;
    await act(async () => {
      second = app.props('ExploreScreen')[`onLoadMore${kind}`]();
    });
    assert.equal(pages, 2);
    await act(async () => {
      old.reject(new Error('Old request failed'));
      await first;
    });
    assert.equal(app.props('ExploreScreen').error, '');
    assert.equal(
      app.props('ExploreScreen')[`${kind.toLowerCase()}LoadingMore`],
      true,
      'Old finally must not finish new pagination',
    );
    await act(async () => {
      next.resolve({ circles: [], people: [] });
      await second;
    });
  });
