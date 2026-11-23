---
name: Python data
description: Idiomatic pandas/numpy workflows with validation and reproducibility.
---
# Python data

## Workflow
- Load with explicit dtypes and `parse_dates`; assert the shape you expect right
  after load (`df.shape`, `df.dtypes`) so silent type coercion cannot pass.
- Prefer vectorized ops over iterrows; reserve `apply` for true row logic.
- Chain transformations into named steps; a pipeline that cannot be re-run from
  a clean interpreter is not finished.

## Hygiene
- Validate inputs with checks (nulls, ranges, duplicates) and fail loudly with
  a message that names the offending column.
- Pin randomness (`random_state`/seed) and record data source + date in the
  notebook/report header.
- Output: write to a typed destination (parquet/duckdb) and print a 5-row head
  plus summary stats so a human can eyeball the result.
