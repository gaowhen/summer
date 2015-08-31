initdb:
	python -m tool.initdb

fillup:
	python -m tool.fillup

pip:
	pip install -r requirements.txt

test:
	python -m tests.test