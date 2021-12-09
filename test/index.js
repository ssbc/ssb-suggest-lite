// SPDX-FileCopyrightText: 2021 Andre Staltz
//
// SPDX-License-Identifier: Unlicense

const test = require('tape');
const fs = require('fs');
const path = require('path');
const generateFixture = require('ssb-fixtures');
const SecretStack = require('secret-stack');
const caps = require('ssb-caps');
const ssbKeys = require('ssb-keys');
const pull = require('pull-stream');
const fromEvent = require('pull-stream-util/from-event');
const {
  where,
  and,
  type,
  descending,
  paginate,
  toCallback,
  author,
} = require('ssb-db2/operators');

const dir = '/tmp/ssb-suggest-lite';
const oldLogPath = path.join(dir, 'flume', 'log.offset');
const newLogPath = path.join(dir, 'db2', 'log.bipf');

const SEED = 'dinghy';
const MESSAGES = 10000;
const AUTHORS = 500;

test('generate fixture', (t) => {
  if (fs.existsSync(oldLogPath)) {
    t.end();
    return;
  }

  generateFixture({
    outputDir: dir,
    seed: SEED,
    messages: MESSAGES,
    authors: AUTHORS,
    slim: true,
  }).then(() => {
    t.true(fs.existsSync(oldLogPath), 'fixture was created');

    const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
    const sbot = SecretStack({appKey: caps.shs})
      .use(require('ssb-db2'))
      .call(null, {keys, path: dir, db2: {automigrate: true}});

    pull(
      fromEvent('ssb:db2:migrate:progress', sbot),
      pull.filter((progress) => progress === 1),
      pull.take(1),
      pull.drain(() => {
        setTimeout(() => {
          t.true(fs.existsSync(newLogPath), 'ssb-db2 migration completed');

          sbot.db.query(
            where(and(type('about'), author(keys.id, {dedicated: true}))),
            descending(),
            paginate(100),
            toCallback((err, {results, total}) => {
              t.equal(total, 460, 'initial indexing completed');
              sbot.close(t.end);
            }),
          );
        }, 1000);
      }),
    );
  });
});

test('write then suggest', t => {
  const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
  const alice = ssbKeys.loadOrCreateSync(path.join(dir, 'alice'));

  const sbot = SecretStack({appKey: caps.shs})
    .use(require('ssb-db2'))
    .use(require('ssb-db2/compat'))
    .use(require('ssb-db2/about-self'))
    .use(require('ssb-friends'))
    .use(require('../lib/index'))
    .call(null, { keys, path: __dirname + '/foo', friends: {hops: 10} });

  sbot.db.publishAs(alice, {
      type: 'about',
      about: alice.id,
      name: 'alice'
  }, (err) => {
    if (err) {
      t.fail(err)
      return t.end()
    }

    // now get the profile
    sbot.suggest.profile({ text: 'alice' }, (err, res) => {
      if (err) {
        t.fail(err)
        return t.end()
      }
      t.equals(res[0].id, alice.id, 'should return the right profile');
      t.end()
    })
  })

})

test('ssb-suggest-lite on input "labor"', (t) => {
  const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
  const sbot = SecretStack({appKey: caps.shs})
    .use(require('ssb-db2'))
    .use(require('ssb-db2/about-self'))
    .use(require('ssb-friends'))
    .use(require('../lib/index'))
    .call(null, {keys, path: dir, friends: {hops: 10}});

  sbot.suggest.profile({text: 'labor', limit: 5}, (err, results) => {
    t.error(err);
    t.equals(results.length, 5);
    t.equals(results[0].id, keys.id);
    t.equals(results[0].name, 'labore qui fugiat');

    setTimeout(() => {
      sbot.close(t.end);
    }, 1000);
  });
});

test('ssb-suggest-lite on input "lábór"', (t) => {
  const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
  const sbot = SecretStack({appKey: caps.shs})
    .use(require('ssb-db2'))
    .use(require('ssb-db2/about-self'))
    .use(require('ssb-friends'))
    .use(require('../lib/index'))
    .call(null, {keys, path: dir, friends: {hops: 10}});

  sbot.suggest.profile({text: 'lábór', limit: 5}, (err, results) => {
    t.error(err);
    t.equals(results.length, 5);
    t.equals(results[0].id, keys.id);
    t.equals(results[0].name, 'labore qui fugiat');

    setTimeout(() => {
      sbot.close(t.end);
    }, 1000);
  });
});

test('ssb-suggest-lite on input "LABOR"', (t) => {
  const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
  const sbot = SecretStack({appKey: caps.shs})
    .use(require('ssb-db2'))
    .use(require('ssb-db2/about-self'))
    .use(require('ssb-friends'))
    .use(require('../lib/index'))
    .call(null, {keys, path: dir, friends: {hops: 10}});

  sbot.suggest.profile({text: 'LABOR', limit: 5}, (err, results) => {
    t.error(err);
    t.equals(results.length, 5);
    t.equals(results[0].id, keys.id);
    t.equals(results[0].name, 'labore qui fugiat');

    setTimeout(() => {
      sbot.close(t.end);
    }, 1000);
  });
});

test('ssb-suggest-lite supports opts.limit', (t) => {
  const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
  const sbot = SecretStack({appKey: caps.shs})
    .use(require('ssb-db2'))
    .use(require('ssb-db2/about-self'))
    .use(require('ssb-friends'))
    .use(require('../lib/index'))
    .call(null, {keys, path: dir, friends: {hops: 10}});

  sbot.suggest.profile({text: 'al', limit: 3}, (err, results) => {
    t.error(err);
    t.equals(results.length, 3);

    setTimeout(() => {
      sbot.close(t.end);
    }, 1000);
  });
});

test('ssb-suggest-lite with defaultIds', (t) => {
  const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
  const sbot = SecretStack({appKey: caps.shs})
    .use(require('ssb-db2'))
    .use(require('ssb-db2/about-self'))
    .use(require('ssb-friends'))
    .use(require('../lib/index'))
    .call(null, {keys, path: dir, friends: {hops: 10}});

  const ID1 = '@DD85UcOClexP25DZUho84Z094NVZHKpBfiDdfqeA5qc=.ed25519';
  const ID2 = '@BLi0h5STzJkSiHwkKT8XtrpmiYzDTw3TCVXNEuGTLOw=.ed25519';

  sbot.suggest.profile({defaultIds: [ID1, ID2]}, (err, results) => {
    t.error(err);
    t.equals(results.length, 2);
    t.equals(results[0].id, ID1);
    t.equals(results[0].name, 'quis laboris');
    t.equals(results[1].id, ID2);
    t.equals(results[1].name, 'consequat');

    setTimeout(() => {
      sbot.close(t.end);
    }, 1000);
  });
});

test.skip('ssb-suggest on input "labor"', (t) => {
  t.timeoutAfter(30e3);
  const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
  const sbot = SecretStack({appKey: caps.shs})
    .use(require('ssb-db2'))
    .use(require('ssb-about'))
    .use(require('ssb-friends'))
    .use(require('ssb-suggest'))
    .call(null, {keys, path: dir});

  setTimeout(() => {
    sbot.suggest.profile({text: 'labor', limit: 5}, (err, results) => {
      t.error(err);
      t.equals(results.length, 1);
      t.equals(results[0].id, keys.id);
      t.equals(results[0].name, 'labore qui fugiat');
      sbot.close(t.end); // FIXME: fix the `catch` part of ssb-db2 close()
    });
  }, 6e3);
});

test.skip('ssb-suggest with defaultIds', (t) => {
  t.timeoutAfter(30e3);
  const keys = ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));
  const sbot = SecretStack({appKey: caps.shs})
    .use(require('ssb-db2'))
    .use(require('ssb-about'))
    .use(require('ssb-friends'))
    .use(require('ssb-suggest'))
    .call(null, {keys, path: dir});

  const ID1 = '@DD85UcOClexP25DZUho84Z094NVZHKpBfiDdfqeA5qc=.ed25519';
  const ID2 = '@BLi0h5STzJkSiHwkKT8XtrpmiYzDTw3TCVXNEuGTLOw=.ed25519';

  setTimeout(() => {
    sbot.suggest.profile({defaultIds: [ID1, ID2]}, (err, results) => {
      t.error(err);
      t.equals(results.length, 2);
      t.equals(results[0].id, ID1);
      t.equals(results[0].name, 'quis laboris');
      t.equals(results[1].id, ID2);
      t.equals(results[1].name, 'consequat');
      sbot.close(t.end); // FIXME: fix the `catch` part of ssb-db2 close()
    });
  }, 6e3);
});
