#!/bin/sh

set -e

npm install
node lib/main --mode=deploy --instanceType=gce --teardown
