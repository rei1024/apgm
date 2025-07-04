# APGM

APGsembly macro language

APGM is a language created to output APGsembly. It uses structured programming
and macros.

[APGM - APGsembly macro language](https://rei1024.github.io/apgm/)

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

- `deno` above 2.3.5
  - <https://docs.deno.com/runtime/manual>

### Usage

- `$ deno task up` Local server
  - access to [http://localhost:1618/](http://localhost:1618/)
- `$ deno task t` Unit tests
- `$ deno task w` Unit tests with file watcher
- `$ deno task cov` Unit tests coverage
- `$ deno task fmt` Formatting
- `$ deno task build` Bundling
