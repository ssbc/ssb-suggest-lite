// SPDX-FileCopyrightText: 2021 Andre Staltz
//
// SPDX-License-Identifier: LGPL-3.0-only

import {plugin, muxrpc} from 'secret-stack-decorators';
import {BlobId, FeedId, Msg} from 'ssb-typescript';
import run = require('promisify-tuple');
const pull = require('pull-stream');
const {onceWhen} = require('ssb-db2/utils');
import Deferred = require('p-defer');

interface CB<T> {
  (err: any, val?: T): void;
}

interface SSB {
  id: FeedId;
  db?: {
    query: CallableFunction;
    stateFeedsReady: any;
    getIndex: CallableFunction;
    getState: () => Record<FeedId, Msg>;
    onDrain: (indexName: string, cb: CB<void>) => void;
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
  name: string;
  image?: BlobId;
  latest: number;
}

function normalize(str: string) {
  return str
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ +/g, '')
    .trim();
}

@plugin('1.0.0')
class suggest {
  private readonly ssb: Required<SSB>;
  private readonly cache: Map<FeedId, Profile>;
  private readonly started: ReturnType<typeof Deferred>;
  private readonly maxHops: number;
  private drainer: any;

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
    if (this.drainer) {
      this.drainer.abort();
      this.drainer = null;
    }

    pull(
      this.ssb.friends.hopStream({live: true, old: true}),
      pull.filter((x: any) => !x.sync),
      pull.asyncMap(async (hops: Record<FeedId, number>, cb: CB<any>) => {
        this.checkAboutSelfPlugin();
        await run(this.ssb.db.onDrain)('base');
        await run(this.ssb.db.onDrain)('aboutSelf');
        const latestKVTs = this.ssb.db.getState();
        const aboutSelfIndex = this.ssb.db.getIndex('aboutSelf');

        // TODO this should be a better API in ssb-db2
        onceWhen(
          this.ssb.db.stateFeedsReady,
          (ready: any) => ready === true,
          () => {
            const feedIds = Object.keys(hops).filter(
              (feedId) => hops[feedId] >= 0 && hops[feedId] <= this.maxHops,
            );

            for (const feedId of feedIds) {
              const profile = aboutSelfIndex.getProfile(feedId);
              if (profile.name) {
                const latestKVT = latestKVTs[feedId];
                this.cache.set(feedId, {
                  id: feedId,
                  name: profile.name,
                  image: profile.image,
                  latest: Math.min(
                    latestKVT?.timestamp ?? 0,
                    latestKVT?.value?.timestamp ?? 0,
                  ),
                });
              }
            }

            // The first `hops` is just the self ID, we want to wait for the
            // `hops` object that contains other accounts, and then signal `started`
            if (feedIds.length > 1 || feedIds[0] !== this.ssb.id) {
              this.started.resolve();
            }
            cb(null, null);
          },
        );
      }),
      (this.drainer = pull.drain(() => {})),
    );

    const that = this;
    this.ssb.close.hook(function (this: any, fn: any, args: any) {
      that.drainer.abort();
      that.drainer = null;
      fn.apply(this, args);
    });

    // Refresh every hour
    setInterval(this.start, 60 * 60 * 1000);
  };

  @muxrpc('async')
  public profile = async (opts: Opts, cb: CB<Array<Profile>>) => {
    await this.started.promise;

    if (opts.text) {
      let results = [...this.cache.values()]
        .map((profile) => {
          const name = normalize(profile.name);
          const query = normalize(opts.text!);
          const score =
            name === query
              ? 3
              : name.startsWith(query)
              ? 2
              : name.includes(query)
              ? 1
              : 0;
          return {...profile, score};
        })
        .filter((profile) => profile.score > 0)
        // 3e9 milliseconds is a heuristic that equals roughly 34 days
        // We want to prioritize names with high scores, unless they are
        // significantly old (inactive months ago)
        .sort((a, b) => b.latest + b.score * 3e9 - (a.latest + a.score * 3e9));

      if (typeof opts.limit === 'number') {
        results = results.slice(0, opts.limit);
      }

      cb(null, results);
    } else if (opts.defaultIds) {
      await run(this.ssb.db.onDrain)('aboutSelf');
      const aboutSelf = this.ssb.db.getIndex('aboutSelf');
      const results = opts
        .defaultIds!.map((id) => {
          const profile = aboutSelf.getProfile(id);
          if (!profile) return null;
          profile.id = id;
          return profile;
        })
        .filter((profile) => !!profile);
      cb(null, results);
    } else {
      cb(null, []);
    }
  };
}

export = suggest;
