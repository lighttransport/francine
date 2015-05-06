#!/bin/sh

set -e

gcc ao.c lodepng.c -lm -o ao

cd compositor
. ./compile.sh
cd ..

npm install

node lib/main --mode=master
