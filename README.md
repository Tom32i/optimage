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
