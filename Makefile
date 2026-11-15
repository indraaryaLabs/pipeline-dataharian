.PHONY: setup test lint fixtures run check

setup:
	python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'

lint:
	ruff check . && ruff format --check . && mypy

test:
	pytest --cov --cov-fail-under=95

# Regenerates the synthetic dashboard fixtures. A test fails when they drift from the code.
fixtures:
	for s in normal partial failed empty; do \
	  dataharian demo --scenario $$s --now 2026-11-15T09:00:00Z --out dashboard/fixtures/$$s.json; \
	done

run:
	dataharian run --db data/warehouse.db --out out/data.json
