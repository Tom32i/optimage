#!/usr/bin/env node

const sharp = require('sharp');
const glob = require('glob');
const fs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');

const TMP_SUFFIX = '.optimage.tmp';

class Optimage {
    constructor(path, ignore, configPath) {
        const { load, merge } = this.constructor;
        const customConfig = load(configPath);

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
        }, customConfig);

        this.cores = sharp.concurrency();
        this.length = 0;
        this.files = null;

        // Formats to optimize: files in any other format are left untouched.
        this.formats = customConfig.formats || ['jpeg', 'png', 'gif', 'webp'];
        this.skipped = 0;

        // Persistent record of the files already optimized, so a run over
        // files optimized in place by a previous run doesn't encode them again.
        this.cacheDir = this.config.cacheDir || '';
        this.liveKeys = new Set();
        this.hits = 0;
        this.misses = 0;

        // Pruning drops cache entries not referenced this run. Disable it with
        // `"pruneCache": false` when several runs share one cacheDir over
        // partial image sets, so they don't delete each other's entries.
        this.pruneCache = customConfig.pruneCache !== false;

        if (this.cacheDir) {
            const { options, jpeg, png, gif, webp } = this.config;
            const sharpVersion = sharp.versions.sharp;

            // Namespace the cache by the encode options + sharp version, so any
            // change to quality/compression or a sharp upgrade invalidates it.
            this.versionHash = crypto.createHash('md5')
                .update(sharpVersion + JSON.stringify({ options, jpeg, png, gif, webp, formats: this.formats }))
                .digest('hex');
            this.versionDir = nodePath.join(this.cacheDir, this.versionHash);

            fs.mkdirSync(this.versionDir, { recursive: true });

            // A first run on an empty cache is expected to optimize everything.
            this.cacheWasEmpty = fs.readdirSync(this.versionDir).length === 0;
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

        // Remove the temporary files an interrupted run may have left behind.
        for (const file of glob.sync(`${path}.*${TMP_SUFFIX}`, { nodir: true })) {
            fs.rmSync(file, { force: true });
        }

        glob(path, { ignore, nodir: true }, this.onFiles);
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

                if (this.skipped) {
                    console.info(`Skipped ${this.skipped} files in other formats.`);
                }

                if (this.cacheDir) {
                    if (this.pruneCache) {
                        this.prune();
                    }

                    console.info(`Optimized ${this.misses}, ${this.hits} already optimized.`);

                    if (this.hits === 0 && this.misses > 0 && !this.cacheWasEmpty) {
                        console.warn('No file was already optimized. The cache only helps when files are optimized in place and kept between runs, see the Caching section of the README.');
                    }
                }

                this.constructor.success('Done!');
            }

            return;
        }

        // Treat next file
        this.optimize(this.files.shift(), this.next);
    }

    encode(file, image, format) {
        const { options, jpeg, png, gif, webp } = this.config;

        return Promise.resolve(format || image.metadata().then(metadata => metadata.format))
            .then(format => {
                switch (format) {
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
            });
    }

    optimize(file, callback) {
        // Stay promise-based on every path so `callback` always runs in a later
        // microtask: a long run of skipped files would otherwise recurse
        // (optimize -> callback -> optimize ...) and overflow the call stack.
        sharp(file).metadata()
            // A file that isn't an image at all, such as a .gitignore matched by
            // the path pattern, is skipped like any other format.
            .catch(error => {
                if (error.message.includes('unsupported image format')) {
                    return {};
                }

                throw error;
            })
            .then(({ format }) => {
                if (!this.formats.includes(format)) {
                    this.skipped++;

                    return;
                }

                if (!this.cacheDir) {
                    this.misses++;

                    return this.encode(file, sharp(file), format)
                        .then(output => this.replace(file, output));
                }

                return fs.promises.readFile(file).then(input => {
                    const key = crypto.createHash('md5').update(input).digest('hex');

                    // Already optimized by a previous run: leave it as is.
                    if (fs.existsSync(nodePath.join(this.versionDir, key))) {
                        this.liveKeys.add(key);
                        this.hits++;

                        return;
                    }

                    this.misses++;

                    return this.encode(file, sharp(input), format).then(output => {
                        const outputKey = crypto.createHash('md5').update(output).digest('hex');

                        this.liveKeys.add(outputKey);

                        // Record the output before replacing the file: if the run
                        // stops in between, the file is still the original and gets
                        // optimized next time, instead of being encoded twice.
                        return fs.promises.writeFile(nodePath.join(this.versionDir, outputKey), '')
                            .then(() => this.replace(file, output));
                    });
                });
            })
            .catch(error => console.error(error))
            .finally(() => callback(file));
    }

    replace(file, buffer) {
        // Write to a temporary file, then rename it: an interrupted run must not
        // leave a truncated image behind.
        const tmpPath = `${file}.${crypto.randomBytes(6).toString('hex')}${TMP_SUFFIX}`;

        return fs.promises.writeFile(tmpPath, buffer)
            .then(() => fs.promises.rename(tmpPath, file));
    }

    prune() {
        // Drop stale version directories (changed options or sharp version).
        // Only touch md5-named entries, in case cacheDir holds anything else.
        for (const entry of fs.readdirSync(this.cacheDir)) {
            if (entry !== this.versionHash && /^[0-9a-f]{32}$/.test(entry)) {
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
