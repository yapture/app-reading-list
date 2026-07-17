# Yapture Reading List

A simple reading tracker built on [Yapture](https://yapture.com) Script and list primitives.

## What it does

- **Add books** using Yapture Script: `Designing Data-Intensive Applications #@technical #!high #*{pages:613,current:142}`
- **Track progress** with visual progress bars (current page / total pages)
- **Filter** by status: reading, to-read, finished
- **Take notes** — yaps with `kind: "note"` attach to a book entry
- **Set goals** — track your yearly reading target

## How it works

This app creates an anonymous Yapture list on first use (no account needed) and stores books as yaps. The Yapture Script parser extracts metadata like tags, priority, and custom fields — the app renders them as a reading-specific UI.

All data stays local until you explicitly connect. The owner capability (a secret link) is your key to the list.

## Run locally

```bash
bun install
bun run dev
```

## Built with

- [Vite](https://vitejs.dev) + React + TypeScript
- [`@yapture/nlp`](https://yapture.com/docs/script) — Script parser
- [`@yapture/script-ui`](https://yapture.com/developers) — badge rendering
- [Yapture Lists API](https://yapture.com/.well-known/yapture-api.md) — anonymous list creation

## Part of the Yapture Market

This is a reference app demonstrating how Yapture's list primitives can power a domain-specific interface. See all reference apps at [yapture.com/market](https://yapture.com/market).
