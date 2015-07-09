#!/bin/sh

set -e

#npm install
node lib/main --mode=createImage --instanceType=gce
