# Variables d'environnement

## Obligatoires

DATABASE_URL        postgresql://postgres:[PWD]@[HOST]:5432/flipsync
DIRECT_URL          postgresql://postgres:[PWD]@[HOST]:5432/flipsync
STRIPE_SECRET_KEY   sk_test_... (test) / sk_live_... (prod)
STRIPE_WEBHOOK_SECRET  whsec_...
JWT_SECRET          min 32 caractères aléatoires
API_PORT            3001
NODE_ENV            development | production

## Dev local

OLLAMA_BASE_URL     http://localhost:11434
OLLAMA_MODEL        moondream2

## Jamais commiter

.env ne doit JAMAIS être dans git.
.env.example est la seule version committée.
