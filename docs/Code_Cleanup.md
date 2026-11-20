# Code Cleanup Before Defense

**All items here are done (2026-11-14).** The current list of open bugs, errors and cleanups is
[`docs/Bugs_and_Errors.md`](Bugs_and_Errors.md) ("Open now" at the top). This file is kept as a record.

How to re-check:

```
npm run lint        # code style and type-safety rules
npm run typecheck   # TypeScript type errors
npm test            # automated tests
```

## ✅ Done: TypeScript errors (14, all in test files)

Fixed in `docs/Bugs_and_Errors.md` item 6.1: the fake users in `reportsHistory.test.tsx` and
`notificationAcknowledgment.test.ts` have the required fields, and the mock and anchor cast are typed.
`npm run typecheck` reports 0 errors.

## ✅ Done: Lint problems (82 errors, 14 warnings)

Fixed in `docs/Bugs_and_Errors.md` items 6.2–6.6 and 7.2: `no-explicit-any` removed from the app code
(test files are exempt by an ESLint override), the regex escapes, empty interfaces and `require()` import
fixed, the two intentional `exhaustive-deps` cases commented, and `frontend/dist` is no longer linted.
`npm run lint` reports 0 errors and 0 warnings.

## ✅ Done: Alert worker dependencies

`npm run worker:check` failed with "'tsx' is not recognized" because the worker's packages were
not installed. Done on 2026-11-13: the packages are installed, the service-account key and `.env`
are in place, the check passes, and push notifications were tested on a phone. On another computer
(for example the defense laptop), run:

```
npm run worker:setup
```

The worker now runs on Render (see `CLAUDE.md`), so a local copy is only needed when Render is down.
Run only one at a time.
