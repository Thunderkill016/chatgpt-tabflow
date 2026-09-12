# TabFlow × CycleWarden Control Center

TabFlow can show a small read-only summary of the local CycleWarden Control Core inside the Side Panel.

## Trust boundary

The integration is intentionally one-way:

```text
TabFlow Side Panel
  -> GET http://127.0.0.1:4318/health
  -> GET http://127.0.0.1:4318/snapshot
```

The companion does **not** call task mutation endpoints and does not send ChatGPT tab or conversation data to CycleWarden.

## Permission model

`http://127.0.0.1/*` is declared as an `optional_host_permissions` entry, not a mandatory host permission.

The extension asks for this permission only after the user presses **Connect local core**. Rejecting the permission leaves every existing TabFlow feature working normally.

The runtime still uses a fixed Control Core endpoint:

```text
http://127.0.0.1:4318
```

The broader path wildcard exists only because Chrome host permission match patterns grant an origin rather than a single API path. The companion source itself only requests `/health` and `/snapshot`.

## UI

The Side Panel shows:

- Control Core online/offline;
- `NEEDS YOU` count;
- `IN FLIGHT` count;
- `READY TO SHIP` count;
- a button that opens `http://localhost:3000/app/control-center`;
- manual refresh.

When the Side Panel is visible it refreshes every five seconds. Hidden Side Panels do not poll.

## Local prerequisite

Run CycleWarden locally first:

```bash
pnpm dev:control-center
```

Then open the TabFlow Side Panel and press **Connect local core** once.

## Non-goals for V1

TabFlow does not run/cancel agents, register repositories, edit files, merge branches or deploy. Mutating controls remain in the dedicated Control Center and the AtoRyn Telegram bridge where their safety boundaries are explicit.
