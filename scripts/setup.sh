#!/bin/sh

# Please run this script from the root directory.

# It looks sometimes apt-get fails to fetch index with the following WARNING/ERROR.
#   W: Failed to fetch http://security.ubuntu.com/ubuntu/dists/vivid-security/universe/i18n/Translation-en  Hash Sum mismatch
#   E: Some index files failed to download. They have been ignored, or old ones used instead.
# We accept this warning anyaway, thus place `set -e` after the apt-get 

apt-get update -y
apt-get upgrade -y

set -e

apt-get install -y nodejs npm supervisor rsync build-essential g++ libc6-i386 lib32stdc++6 lib32gcc1 lib32ncurses5 lib32z1
update-alternatives --install /usr/bin/node node /usr/bin/nodejs 10
npm install

# Compile aobench for testing
gcc ao.c lodepng.c -lm -o ao

# Configure NAT gateway
ufw default allow
ufw default allow routed
echo net/ipv4/ip_forward=1 >> /etc/ufw/sysctl.conf
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

# Configure ulimits
cat >> /etc/security/limits.conf <<EOF
*	soft	nofile	8192
*	hard	nofile	8192
EOF

# Compile Mallie renderer if exists
if [ -d 'mallie' ]; then
	cd mallie
	. scripts/setup_linux.sh
	make
	cd ..
fi

# Compile nanogiex if exists
if [ -d 'nanogiex' ]; then
	# Install some packages
	apt-get update -qq
	apt-get install -qq -y git software-properties-common 
	add-apt-repository -y ppa:george-edison55/cmake-3.x
	apt-get update -qq
	apt-get install -qq -y python cmake build-essential libfreeimage-dev libboost-dev libboost-regex-dev libboost-program-options-dev libboost-system-dev libboost-filesystem-dev freeglut3-dev libxmu-dev libxi-dev libglm-dev libyaml-cpp-dev

	# Install assimp
	git clone --depth=1 --branch v3.1.1 https://github.com/assimp/assimp.git assimp
	mkdir -p assimp/build && cd assimp/build && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j && make install && cd ../../
	
	# Install embree
	git clone --depth=1 --branch v2.5.1 https://github.com/embree/embree.git embree
	mkdir -p embree/build && cd embree/build && cmake -D CMAKE_BUILD_TYPE=Release -D ENABLE_ISPC_SUPPORT=OFF -D RTCORE_TASKING_SYSTEM=INTERNAL -D ENABLE_TUTORIALS=OFF .. && make -j && make install && cp libembree.so /usr/local/lib && cd ../../

	# Build nanogiex
	mkdir -p nanogiex/build && cd nanogiex/build && BOOST_ROOT="" BOOST_INCLUDEDIR="/usr/include" BOOST_LIBRARYDIR="/usr/lib/x86_64-linux-gnu" cmake -DCMAKE_BUILD_TYPE=Release .. && make -j && cd ../../
fi

# Compile Compositor
cd compositor
. ./compile.sh
cd ..

# Copy files to root home directory
sudo rsync -rtv . /root

cat > /etc/supervisor/conf.d/francine.conf <<EOF
[program:francine]
command=bash -c "ulimit -n 8192 && exec node /root/lib/main --instanceType=$1 --useMetadata=true"
autostart=true
autorestart=true
stderr_logfile = /var/log/supervisor/francine-stderr.log
stdout_logfile = /var/log/supervisor/francine-stdout.log
EOF
