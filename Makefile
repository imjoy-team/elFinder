.PHONY: help build clean clean-build clean-pyc

help:
	@echo "build - build a distribution"
	@echo "clean - run all clean operations"
	@echo "clean-build - remove build artifacts"
	@echo "clean-pyc - remove Python file artifacts"

build:
	python setup.py sdist bdist_wheel

clean: clean-build clean-pyc

clean-build:
	rm -fr build/
	rm -fr dist/
	rm -fr *.egg-info

clean-pyc:
	find . -name '*.pyc' -exec rm -f {} +
	find . -name '*.pyo' -exec rm -f {} +
	find . -name '*~' -exec rm -f {} +
