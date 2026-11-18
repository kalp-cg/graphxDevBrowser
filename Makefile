# Every task of the project, one command each. Run from the repository root.
PY := backend/.venv/bin/python

.PHONY: setup demo dev test e2e codebases

setup:            ## Python environment for SentinelGraph, and the app's dependencies
	@test -x $(PY) || (python3 -m venv backend/.venv && $(PY) -m pip install --quiet --upgrade pip && $(PY) -m pip install --quiet -r backend/requirements.txt)
	@test -d DevBrowser/node_modules || (cd DevBrowser && npm ci)

demo: setup       ## DevBrowser + its own SentinelGraph on a clean sample company
	./scripts/demo.sh

dev: setup        ## DevBrowser from source (it starts SentinelGraph by itself)
	cd DevBrowser && env -u ELECTRON_RUN_AS_NODE npm run dev

test: setup       ## Unit tests, type checks and lint
	cd backend && .venv/bin/python -m pytest -q
	cd DevBrowser && npm run typecheck && npm run lint && npm test

e2e: setup        ## The built app end to end against the live sandbox shop (started and stopped here)
	cd DevBrowser && npm run build
	@test -d e2e/node_modules || (cd e2e && npm ci)
	@$(PY) sandbox/run.py up > .sentinel-logs-sandbox.log 2>&1 & SANDBOX=$$!; \
	for i in $$(seq 1 90); do curl -sf localhost:7499/__control >/dev/null && curl -sf localhost:8200/api/health >/dev/null && break; sleep 1; done; \
	(cd e2e && env -u ELECTRON_RUN_AS_NODE npx playwright test -c devbrowser.config.ts); STATUS=$$?; \
	kill $$SANDBOX; exit $$STATUS

codebases: setup  ## Scan 20 real public repositories of every shape
	$(PY) sandbox/codebases.py
