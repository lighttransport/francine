#!/bin/sh
apt-get update -y && \
apt-get install -y nodejs npm supervisor rsync build-essential g++ libc6-i386 lib32stdc++6 lib32gcc1 lib32ncurses5 lib32z1 && \
update-alternatives --install /usr/bin/node node /usr/bin/nodejs 10 && \
npm install && \
gcc ao.c lodepng.c -lm -o ao

if [ -d 'mallie' ]; then
	cd mallie && \
	. scripts/setup_linux.sh && \
	make && \
	cd ..
fi

cd compositor && \
. ./compile.sh && \
cd ..

sudo rsync -rtv . /root

cat > /etc/supervisor/conf.d/francine.conf <<EOF
[program:francine]
command=node /root/lib/main --instanceType=$1 --useMetadata=true
autostart=true
autorestart=true
stderr_logfile = /var/log/supervisor/francine-stderr.log
stdout_logfile = /var/log/supervisor/francine-stdout.log
EOF
