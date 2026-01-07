#!/usr/bin/env node

const sharp = require('sharp');
const glob = require('glob');

class Optimage {
    constructor(path, ignore, configPath) {
        const { load, merge } = this.constructor;

        this.config = merge({
            path,
            ignore,
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
        }  catch (error) {
            try {
                return require(`${process.cwd()}/${path}`);
            }  catch (error) {
                throw new Error(`Could not load config file "${configPath}"`);
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
                this.constructor.success('Done!');
            }

            return;
        }

        // Treat next file
        this.optimize(this.files.shift(), this.next);
    }

    optimize(file, callback) {
        const { options, jpeg, png, gif, webp } = this.config;
        const image = sharp(file);

        image
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
            .then(buffer => sharp(buffer).toFile(file))
            .catch(error => console.error(error))
            .finally(() => callback(file))
    }

    clear() {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
    }

    display(message) {
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
