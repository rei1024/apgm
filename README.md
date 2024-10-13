# APGM

APGsembly macro language

APGM is a language created to output APGsembly. It uses structured programming
and macros.

[APGM - APGsembly macro language](https://rei1024.github.io/proj/apgm/)

## Pipeline

```mermaid
graph TD
    APGM0[APGM code] -->|Parse| APGM1[APGM + Macro]
    APGM1[APGM + Macro] -->|Expand macro| APGM2[APGM]
    APGM2[APGM] -->|Transpile| APGL1[APGL]
    APGL1[APGL] -->|Optimize sequence| APGL2[APGL]
    APGL2[APGL] -->|Optimize actions| APGL3[APGL]
    APGL3[APGL] -->|Transpile| APGsembly[APGsembly]
```

## Testing

### Requirements

- `deno` above 2.0.0
  - <https://docs.deno.com/runtime/manual>

### Usage

- `$ deno task up` Local server
  - access to [http://localhost:1618/](http://localhost:1618/)
- `$ deno task t` Unit tests
- `$ deno task w` Unit tests with file watcher
- `$ deno task fmt` Formatting
- `$ deno task bundle` Bundling

## Coverage

### Requirements

- `deno`
- `lcov`
  - https://formulae.brew.sh/formula/lcov

### Usage

- `$ deno task cov` open lcov page
