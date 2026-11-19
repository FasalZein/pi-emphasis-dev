The staging deploy for checkout failed during the database migration step, so none of the new code was actually rolled out. The good news is that staging is still running last night's build, so nothing is broken there right now.

## What happened

The pipeline got through the earlier stages without problems. All 212 tests passed and the build completed successfully. It was the migration that failed, and because of that the rollout step was skipped.

The migration adds a new required column to the `orders` table. The problem is that there are 41 older rows in that table that don't have a value for the new column, so the database rejects the change. This isn't a one-off, either: I found the same error in the last three deploy logs, which explains why it keeps failing.

Looking at those 41 rows, I think they were created before the March import, although I haven't confirmed that. I also haven't been able to check whether production has rows like these, so it's possible the same migration would fail there too.

One more thing to keep in mind is that the `orders` table isn't only used by checkout. The **billing service** reads from it as well, so any change we make to that table could affect billing, not just checkout.

## Possible fixes

There are a few ways we could handle this:

- **Backfill the missing values first.** We could fill in the 41 rows with a default value and then run the migration as it is. This is the option I'd recommend, since it fixes the data without changing the migration.
- **Make the new column optional.** This would let us ship right away and make the column required later. The downside is that the code would have to deal with two different kinds of order rows in the meantime.
- **Delete the old rows.** This would also unblock the migration, but it's destructive: it removes order history that the billing service may still need, so I'd be careful with this one.

If you'd like, I can prepare the backfill as a dry run first, without touching staging, so you can see exactly what would change. Which option would you like to go with?
