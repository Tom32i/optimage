#!/usr/bin/env node

const sharp = require('sharp');
const glob = require('glob');
const fs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');

class Optimage {
    constructor(path, ignore, configPath) {
        const { load, merge } = this.constructor;

        this.config = merge({
            path,
            ignore,
            cacheDir: '',
            cache: {},
            options: {},
            png: {},
            webp: {},
            jpeg: {},
            gif: {},
        }, load(configPath));

        this.cores = sharp.concurrency();
        this.length = 0;
        this.files = null;

        // Persistent, content-addressed optimization cache.
        this.cacheDir = this.config.cacheDir || '';
        this.liveKeys = new Set();
        this.hits = 0;
        this.misses = 0;

        if (this.cacheDir) {
            const { options, jpeg, png, gif, webp } = this.config;
            const sharpVersion = require('sharp/package.json').version;

            // Namespace the cache by the encode options + sharp version, so any
            // change to quality/compression or a sharp upgrade invalidates it.
            this.versionHash = crypto.createHash('md5')
                .update(sharpVersion + JSON.stringify({ options, jpeg, png, gif, webp }))
                .digest('hex');
            this.versionDir = nodePath.join(this.cacheDir, this.versionHash);

            fs.mkdirSync(this.versionDir, { recursive: true });
        }

        this.onFiles = this.onFiles.bind(this);
        this.next = this.next.bind(this);

        sharp.cache(this.config.cache);
    }

    static merge(defaultConfig, customConfig) {
        const config = {};

        for (const [key, value] of Object.entries(defaultConfig)) {
            if (typeof value === 'object') {
                config[key] = Object.assign(value, customConfig[key] || {});
            } else {
                config[key] = value || customConfig[key];
            }
        }

        return config;
    }

    static load(path) {
        if (!path) {
            return {};
        }

        try {
            return require(path);
        }  catch {
            try {
                return require(`${process.cwd()}/${path}`);
            }  catch (error) {
                throw new Error(`Could not load config file "${path}"`, { cause: error });
            }
        }
    }

    exec() {
        const { path, ignore } = this.config;

        if (!path) {
            throw new Error('You must provide a path as first argument or through the "path" config key.');
        }

        glob(path, { ignore }, this.onFiles);
    }

    onFiles(error, files) {
        if (error) {
            throw new Error(error);
        }

        this.files = files;
        this.length = files.length;

        console.info(`Optimizing ${this.length} files with ${this.cores} cores...`);

        for (let i = 0; i < this.cores; i++) {
            setTimeout(this.next, 0);
        }
    }

    next(file = undefined) {
        const { length: total } = this;
        const { length: remainging } = this.files;

        // Previous treated file
        if (file) {
            const treated = total - remainging;

            this.display(`File ${treated}/${total}: ${(treated/total * 100).toFixed(2)}%  -  ${file}`);
        }

        // Queue is empty
        if (!remainging) {
            this.cores--;

            if (this.cores === 0) {
                this.clear();

                if (this.cacheDir) {
                    this.prune();

                    const ratio = total ? (this.hits / total * 100).toFixed(2) : '0.00';

                    console.info(`Restored ${this.hits}/${total} (${ratio}%) from cache, optimized ${this.misses}.`);
                }

                this.constructor.success('Done!');
            }

            return;
        }

        // Treat next file
        this.optimize(this.files.shift(), this.next);
    }

    encode(file, image) {
        const { options, jpeg, png, gif, webp } = this.config;

        return image
            .metadata()
            .then(metadata => {
                switch (metadata.format) {
                case 'jpeg':
                    return image.jpeg({ ...options, ...jpeg }).toBuffer();

                case 'png':
                    return image.png({ ...options, ...png }).toBuffer();

                case 'gif':
                    return image.gif({ ...options, ...gif }).toBuffer();

                case 'webp':
                    return image.webp({ ...options, ...webp }).toBuffer();

                default:
                    throw new Error(`Unsupported image type "${file}".`);
                }
            })
            .then(buffer => sharp(buffer).toBuffer());
    }

    optimize(file, callback) {
        if (!this.cacheDir) {
            this.encode(file, sharp(file))
                .then(buffer => fs.promises.writeFile(file, buffer))
                .catch(error => console.error(error))
                .finally(() => callback(file));

            return;
        }

        let input;

        try {
            input = fs.readFileSync(file);
        } catch (error) {
            console.error(error);

            return callback(file);
        }

        const key = crypto.createHash('md5').update(input).digest('hex');
        const cachePath = nodePath.join(this.versionDir, key);

        this.liveKeys.add(key);

        // Cache hit: restore the previously optimized bytes, skip sharp entirely.
        if (fs.existsSync(cachePath)) {
            try {
                fs.copyFileSync(cachePath, file);
                this.hits++;
            } catch (error) {
                console.error(error);
            }

            return callback(file);
        }

        // Cache miss: optimize, then write to both the target file and the cache.
        this.misses++;

        this.encode(file, sharp(input))
            .then(buffer => Promise.all([
                fs.promises.writeFile(file, buffer),
                fs.promises.writeFile(cachePath, buffer),
            ]))
            .catch(error => console.error(error))
            .finally(() => callback(file));
    }

    prune() {
        // Drop stale version directories (changed options or sharp version).
        for (const entry of fs.readdirSync(this.cacheDir)) {
            if (entry !== this.versionHash) {
                fs.rmSync(nodePath.join(this.cacheDir, entry), { recursive: true, force: true });
            }
        }

        // Drop entries in the current version that weren't referenced this run.
        for (const entry of fs.readdirSync(this.versionDir)) {
            if (!this.liveKeys.has(entry)) {
                fs.rmSync(nodePath.join(this.versionDir, entry), { force: true });
            }
        }
    }

    clear() {
        // Only available on a TTY; skip when output is piped (CI, build logs).
        if (process.stdout.isTTY) {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
        }
    }

    display(message) {
        if (!process.stdout.isTTY) {
            return;
        }

        this.clear();
        process.stdout.write(message);
    }

    static success(message) {
        console.info(message);
        process.exit(0);
    }

    static fail(message) {
        console.error(message);
        process.exit(1);
    }
}

const { _: args, config: configPath } = require('minimist')(process.argv.slice(2));
const [ path, ignore ] = args;

try {
    (new Optimage(path, ignore, configPath)).exec();
} catch (error) {
    Optimage.fail(error);
}
