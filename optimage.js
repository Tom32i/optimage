#!/usr/bin/env node

const sharp = require('sharp');
const glob = require('glob');
const { _: args, config: configPath } = require('minimist')(process.argv.slice(2));

const [ path, ignore ] = args;
const config = merge({
    cache: {},
    options: {},
    png: {},
    webp: {},
    jpg: {},
    gif: {},
}, configPath ? require(configPath) : {});

function merge(defaultConfig, passedConfig) {
    const config = {};

    for (const [key, value] of Object.entries(defaultConfig)) {
        config[key] = Object.assign(value, passedConfig[key] || {});
    }

    return config;
}

function optimizeAll(files) {
    const { cache } = config;
    const { length } = files;
    let cores = sharp.concurrency();

    console.info(`Optimizing ${length} files with ${cores} cores...`);

    sharp.cache(cache);

    const next = () => optimize(files.shift(), file => {
        if (files.length) {
            const treated = length - files.length;

            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(`File ${treated}/${length}: ${(treated/length * 100).toFixed(2)}%  -  ${file}`);

            next();
        } else {
            cores--;

            if (cores === 1) {
                process.stdout.clearLine();
                process.stdout.cursorTo(0);
                console.info('Done!');
            }
        }
    });

    for (let i = 0; i < cores; i++) {
        next();
    }
}

function optimize(file, callback = undefined) {
    const write = (error, buffer) => sharp(buffer).toFile(file, () => callback(file));
    const { options, jpg, png, gif, webp } = config;

    switch (file.split('.').pop()) {
    case 'jpeg':
    case 'jpg':
        return sharp(file).jpeg({ ...options, ...jpg }).toBuffer(write);

    case 'png':
        return sharp(file).png({ ...options, ...png }).toBuffer(write);

    case 'gif':
        return sharp(file).gif({ ...options, ...gif }).toBuffer(write);

    case 'webp':
        return sharp(file).webp({ ...options, ...webp }).toBuffer(write);

    default:
        throw new Error(`Unsupported image type "${file}".`);
    }
}

glob(path, { ignore }, (error, files) => {
    if (error) {
        throw new Error(error);
    }

    optimizeAll(files);
});
