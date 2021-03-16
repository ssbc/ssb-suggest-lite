import {plugin, muxrpc} from 'secret-stack-decorators';
import {BlobId, FeedId} from 'ssb-typescript';
const pull = require('pull-stream');
import Deferred = require('p-defer');

interface CB<T> {
  (err: any, val?: T): void;
}

interface SSB {
  db?: {
    query: CallableFunction;
    getIndex: CallableFunction;
    onDrain: CallableFunction;
  };
  friends?: {
    hopStream: CallableFunction;
  };
  close?: {
    hook: CallableFunction;
  };
}

interface Config {
  suggest?: {
    autostart?: boolean;
  };
  friends?: {
    hops?: number;
  };
}

interface Opts {
  text?: string;
  limit?: number;
  defaultIds?: Array<FeedId>;
}

interface Profile {
  id: FeedId;
  name?: string;
  image?: BlobId;
}

const collator =
  typeof Intl === 'object'
    ? new Intl.Collator('default', {sensitivity: 'base', usage: 'search'})
    : null;

function matches(subject: string, target: string) {
  const _subject = subject.toLocaleLowerCase()
  const _target = target.toLocaleLowerCase()
  const slicedSubject = _subject.slice(0, _target.length);
  if (collator) {
    return collator.compare(slicedSubject, _target) === 0;
  } else if (slicedSubject.localeCompare(_target) === 0) {
    return true;
  } else {
    return _subject.startsWith(_target);
  }
}

@plugin('1.0.0')
class suggest {
  private readonly ssb: Required<SSB>;
  private readonly cache: Map<string, Profile>;
  private readonly started: ReturnType<typeof Deferred>;
  private readonly maxHops: number;

  constructor(ssb: SSB, config: Config) {
    if (!ssb.db?.query) {
      throw new Error('"ssb-suggest-lite" is missing required "ssb-db2"');
    }
    if (!ssb.friends?.hopStream) {
      throw new Error('"ssb-suggest-lite" is missing required "ssb-friends"');
    }
    this.ssb = ssb as Required<SSB>;
    this.cache = new Map();
    this.started = Deferred();
    this.maxHops = config.friends?.hops ?? 1;

    if (config.suggest?.autostart ?? true) this.start();
  }

  private checkAboutSelfPlugin() {
    if (!this.ssb.db.getIndex('aboutSelf')) {
      throw new Error(
        '"ssb-suggest-lite" is missing required "ssb-db2/about-self" plugin',
      );
    }
  }

  @muxrpc('sync')
  public start = () => {
    let drainer: any;
    pull(
      this.ssb.friends.hopStream({live: true, old: true}),
      pull.filter((x: any) => !x.sync),
      (drainer = pull.drain((hops: Record<FeedId, number>) => {
        this.checkAboutSelfPlugin();
        const feedIds = Object.keys(hops);
        for (let i = 0, n = feedIds.length; i < n; i++) {
          const feedId = feedIds[i];
          const isLast = i === n - 1;
          if (hops[feedId] >= 0 && hops[feedId] <= this.maxHops) {
            const aboutSelf = this.ssb.db.getIndex('aboutSelf');
            this.ssb.db.onDrain('aboutSelf', () => {
              const profile = aboutSelf.getProfile(feedId);
              if (profile.name) {
                this.cache.set(profile.name, {
                  id: feedId,
                  name: profile.name,
                  image: profile.image,
                });
              }
              if (isLast) {
                this.started.resolve();
              }
            });
          }
        }
      })),
    );
    this.ssb.close.hook(function (this: any, fn: any, args: any) {
      drainer.abort();
      fn.apply(this, args);
    });
  };

  @muxrpc('async')
  public profile = (opts: Opts, cb: CB<Array<Profile>>) => {
    this.started.promise.then(() => {
      if (opts.text) {
        let results = [...this.cache.entries()]
          .filter(([name]) => matches(name, opts.text!))
          .map(([, profile]) => profile);

        if (typeof opts.limit === 'number') {
          results = results.slice(0, opts.limit);
        }

        cb(null, results);
      } else if (opts.defaultIds) {
        this.ssb.db.onDrain('aboutSelf', () => {
          const aboutSelf = this.ssb.db.getIndex('aboutSelf');
          const results = opts
            .defaultIds!.map((id) => {
              const profile = aboutSelf.getProfile(id);
              profile.id = id;
              return profile;
            })
            .filter((profile) => !!profile);
          cb(null, results);
        });
      } else {
        cb(null, []);
      }
    });
  };
}

export = suggest;
