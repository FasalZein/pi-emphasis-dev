**Finding:** [[Investigate]] the staging deploy stopped in the database migration, before any new code went out. Staging is still serving last night's build.

## Scoreboard

[[Done 3]] [[Failed 1]] [[Unverified 1]] [[Needs you 1]]

## What happened

- **Result:** [[Passed 212/212]] tests → [[Done]] build → [[Failed]] migration → [[Skipped]] rollout
- **Cause:** [[Observed]] the migration adds a required column to the orders table, and 41 older rows have no value for it.
- **Evidence:**
  ├── [[Observed]] the same error appears in the last three deploy logs
  ├── [[Inferred]] those rows predate the March import
  └── [[Unverified]] whether production has rows like them
- **Risk:** [[Shared]] the orders table is also read by the **billing service**, so a change there reaches beyond checkout.

## Options

1. **Backfill first** [[Recommended]] fill the 41 rows with a default, then run the migration unchanged.
2. **Make the column optional** ship now and tighten it later. This leaves *two* kinds of order rows in the code.
3. **Drop the old rows** [[Destructive]] removes order history that billing may still need.

**Next:** [[Decision]] which option? I can prepare the backfill as a dry run without touching staging.
