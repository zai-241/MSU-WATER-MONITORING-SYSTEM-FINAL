# Code Cleanup Before Defense

Status checked on 2026-11-13. None of these break the running system: all 77 tests pass and the
web app and Android app build. They matter only if a panelist reads the code or runs the checks.
Do them last, after the manuscript.

How to re-check:

```
npm run lint        # code style and type-safety rules
npm run typecheck   # TypeScript type errors
npm test            # automated tests
```

## 1. TypeScript errors (14, all in test files)

The app code itself has no type errors. Two test files build fake data that no longer matches
the current types.

| File | Lines | Problem | Fix |
|---|---|---|---|
| `frontend/src/test/reportsHistory.test.tsx` | 99, 147, 224, 285, 330, 386, 437 | Fake users are missing `createdAt`, which `UserProfile` now requires | Add `createdAt: Date.now()` to each fake user |
| `frontend/src/test/reportsHistory.test.tsx` | 506 | Casts `void` to `HTMLAnchorElement` | Cast through `unknown`, or type the mock to return an element |
| `frontend/src/test/notificationAcknowledgment.test.ts` | 63, 74, 93, 118, 141, 161 | Fake objects are missing fields that the current types require | Add the missing fields named in the `npm run typecheck` output |

## 2. Lint problems (82 errors, 14 warnings)

| Count | Rule | Where | What to do |
|---|---|---|---|
| 77 | `no-explicit-any` | Mostly `test/reportsHistory.test.tsx` (32) and `pages/admin/Configuration.tsx` (15); also `AuthContext.tsx`, `TankAssignment.tsx`, `useStore.ts`, `Reports.tsx`, `UserManagement.tsx`, others | Replace `any` with the real type (`Tank`, `SystemConfig`, `UserProfile`, `unknown` for caught errors) |
| 2 | `react-hooks/exhaustive-deps` | `pages/admin/Configuration.tsx` lines 78 and 84 | Not a bug: the effects intentionally leave out `localConfig` / `localTank1` so a form being edited isn't overwritten by live updates. Add an `// eslint-disable-next-line react-hooks/exhaustive-deps` comment with that reason |
| 2 | `no-useless-escape` | `pages/Logs.tsx:52`, `pages/Notifications.tsx:61` | Change `\/` to `/` in the regex |
| 2 | `no-empty-object-type` | `components/ui/command.tsx:24`, `components/ui/textarea.tsx:5` | Generated shadcn/ui code: replace the empty interface with a `type` alias |
| 1 | `no-require-imports` | `frontend/tailwind.config.ts:95` | Change `require("tailwindcss-animate")` to an `import` at the top |
| 10 | `react-refresh/only-export-components` (warning) | shadcn/ui components | Safe to ignore |
| 2 | Unused eslint-disable (warning) | `frontend/public/firebase-messaging-sw.js` and `frontend/dist/...` | Remove the comment in `public/`; see the next row for `dist/` |
| n/a | Built files linted | `eslint.config.js` ignores `dist` but the build goes to `frontend/dist` | Change the ignore to `"frontend/dist"` |

---

## Done

### ✅ Done: Alert worker dependencies

`npm run worker:check` failed with "'tsx' is not recognized" because the worker's packages were
not installed. Done on 2026-11-13: the packages are installed, the service-account key and `.env`
are in place, the check passes, and push notifications were tested on a phone. On another computer
(for example the defense laptop), run:

```
npm run worker:setup
```

then `npm run worker` and leave it running. Phone notifications only arrive while it runs.

