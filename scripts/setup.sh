#!/bin/sh

# Please run this script from the root directory.

set -e

apt-get update -y
apt-get install -y nodejs npm supervisor rsync build-essential g++ libc6-i386 lib32stdc++6 lib32gcc1 lib32ncurses5 lib32z1
update-alternatives --install /usr/bin/node node /usr/bin/nodejs 10
npm install

# Compile aobench for testing
gcc ao.c lodepng.c -lm -o ao

# Configure NAT gateway
sysctl -w net.ipv4.ip_forward=1
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
apt-get install -y iptables-persistent

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
