#!/bin/sh
apt-get update -y
apt-get install -y nodejs npm supervisor rsync
update-alternatives --install /usr/bin/node node /usr/bin/nodejs 10
npm install
gcc ao.c lodepng.c -lm -o ao 

sudo rsync -rtv `pwd` /root

cat > /etc/supervisor/conf.d/francine.conf <<EOF
[program:francine]
command=node /root/lib/main --instanceType=$1 --useMetadata=true
autostart=true
autorestart=true
stderr_logfile = /var/log/supervisor/francine-stderr.log
stdout_logfile = /var/log/supervisor/francine-stdout.log
EOF
