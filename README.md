# Optimage

## Installation

```shell
npm install -D optimage-cli
```

## Usage

`npx optimage-cli "{path}" "{ignore}" [--config=path/to/config.json]`

### Argument

| Argument | Description | Example |
| -------- | ----------- | ------- |
| `path` | A [Glob pattern](https://github.com/isaacs/node-glob#glob-primer) that match all files to optimize. | `"images/**/*.@(png|jpg|jpeg|gif|webp)"` |
| `ignore` | A [Glob pattern](https://github.com/isaacs/node-glob#glob-primer) that match files to ignore. | `"images/raw/*"` |

### Options

| Option | Description | Example |
| -------- | ----------- | ------- |
| `--config` | Relative or absolute path the a JSON config file. | `optimage.json` |

### Example usage

```shell
node optimage "images/**/*.@(png|jpg|jpeg|gif|webp)" "images/raw/**/*" --config=optimage.json
```

Optimize all png and jpeg image files in `./images` exept those in the `./images/raw` folder using configuration from `optimage.json`.


## Configuration

| Entry | Description |
| ----- | ----------- |
| `formats` | Image formats to optimize, detected from the file contents. Files in other formats are left untouched. Defaults to `["jpeg", "png", "gif", "webp"]`. |
| `cacheDir` | Path to a directory where optimage records the files it has already optimized, so later runs skip them. See [Caching](#caching). |
| `pruneCache` | Defaults to `true`. After each run, records of files not seen during that run are deleted. Set to `false` when several runs share one `cacheDir` over different image sets (see [Caching](#caching)). |
| `cache` | [Sharp cache configuration](https://sharp.pixelplumbing.com/api-utility#cache) |
| `options` | [Sharp images options (applied to all formats)](https://sharp.pixelplumbing.com/api-utility#cache) |
| `jpeg` | [Sharp jpeg options](https://sharp.pixelplumbing.com/api-output#jpeg) |
| `png` | [Sharp png options](https://sharp.pixelplumbing.com/api-output#png) |
| `webp` | [Sharp webp options](https://sharp.pixelplumbing.com/api-output#webp) |
| `gif` | [Sharp gif options](https://sharp.pixelplumbing.com/api-output#gif) |

### Example configuration

`optimage.json`:

```json
{
  "cache": {
    "memory":  500
  },
  "options": {
    "quality": 80
  },
  "png": {
    "compressionLevel": 9
  },
  "webp": {
    "reductionEffort": 6
  },
  "jpeg": {
    "quality": 75
  }
}
```

## Caching

When optimage rewrites files in place and those files are kept between runs (a thumbnail cache, a folder of generated assets), each run would encode every file again, including the ones a previous run already optimized. Re-encoding is slow, and for lossy formats it lowers the quality each time. Set `cacheDir` to only optimize the files that are new or changed:

```json
{
  "path": "var/thumbnails/**/*",
  "formats": ["png", "jpeg"],
  "cacheDir": "var/optimage-cache",
  "options": { "quality": 80 },
  "png": { "compressionLevel": 9 }
}
```

How it works:

- When optimage optimizes a file, it records the `md5` of the optimized bytes as an empty file in `cacheDir`. It stores no copy of the image.
- On later runs, a file whose `md5` is recorded is skipped: it is already optimized. Any other file is optimized and recorded.
- The records are namespaced by a hash of the encode options, the formats and the installed `sharp` version, so changing settings or upgrading `sharp` optimizes everything again.
- Files are replaced through a temporary file and a rename, and a record is written before its file is replaced. An interrupted run never leaves a truncated image, and never makes a later run encode a file twice.
- After each run the cache is **pruned**: records of files not seen during the run, and stale namespaces, are deleted. Only the cache's own md5-named folders are removed from `cacheDir`; anything else in it is left alone.

> **One image set per `cacheDir`.** Pruning assumes a single run covers the whole set. If you run `optimage` over *partial* sets that share one `cacheDir` (e.g. one run per subfolder), each run deletes the records it didn't see, and concurrent runs with different encode options wipe each other's namespaces. For those workflows set `"pruneCache": false` (and clean the cache yourself when needed), or give each set its own `cacheDir`.

> **Note:** The cache only helps when the optimized files are kept between runs. If a build step writes fresh, unoptimized files before each run, nothing is ever recorded as optimized: run optimage on the files the build copies from instead.
