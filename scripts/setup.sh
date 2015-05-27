#!/bin/sh

# Please run this script from the root directory.

set -e

apt-get update -y
apt-get upgrade -y
apt-get install -y nodejs npm supervisor rsync build-essential g++ libc6-i386 lib32stdc++6 lib32gcc1 lib32ncurses5 lib32z1
update-alternatives --install /usr/bin/node node /usr/bin/nodejs 10
npm install

# Compile aobench for testing
gcc ao.c lodepng.c -lm -o ao

# Configure NAT gateway
ufw default allow
ufw default allow routed
sysctl -w net.ipv4.ip_forward=1
cat /etc/ufw/before.rules > /tmp/before.rules
cat > /etc/ufw/before.rules <<EOF
*nat
:POSTROUTING ACCEPT [0:0]
-A POSTROUTING -s 10.240.0.0/16 -o eth0 -j MASQUERADE
COMMIT

EOF
cat /tmp/before.rules >> /etc/ufw/before.rules
ufw disable
yes | ufw enable

# Compile Mallie renderer if exists
if [ -d 'mallie' ]; then
	cd mallie
	. scripts/setup_linux.sh
	make
	cd ..
fi

# Compile Compositor
cd compositor
. ./compile.sh
cd ..

# Copy files to root home directory
sudo rsync -rtv . /root

cat > /etc/supervisor/conf.d/francine.conf <<EOF
[program:francine]
command=node /root/lib/main --instanceType=$1 --useMetadata=true
autostart=true
autorestart=true
stderr_logfile = /var/log/supervisor/francine-stderr.log
stdout_logfile = /var/log/supervisor/francine-stdout.log
EOF
