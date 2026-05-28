# Skill: Connect and Sync with Manifest Backend

## Context
This project uses Manifest (https://manifest.build) as its Backend-as-a-Service. The backend schema is defined locally via `manifest.yaml`.

## Authentication & Connection
- The Manifest local development backend can be interacted with using the `manifest` CLI commands.
- For local operations, ensure `manifest server` or `manifest dev` is running, typically exposed on `http://localhost:4444` (or your specific Manifest port).
- The front-end or agent-generated services should point their base API URL to this address.

## Allowed Commands
When modifying the backend or syncing changes, the agent is authorized to run:
- `manifest status`
- `manifest deploy` (if executing a cloud push)