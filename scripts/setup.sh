#!/bin/bash
# Script di setup dell'ambiente (locale o Claude Code sul web).
# Da usare come "setup script" dell'ambiente cloud: installa le dipendenze
# npm così test (vitest), typecheck (tsc) e build funzionano subito.
#
# Rete richiesta: registry npm (registry.npmjs.org) e, a runtime, Supabase
# (*.supabase.co).
set -euo pipefail

cd "$(dirname "$0")/.."

# Idempotente: npm install è un no-op rapido se node_modules è già presente.
npm install --no-audit --no-fund
