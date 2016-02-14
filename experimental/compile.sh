#!/bin/sh
protoc --cpp_out=. francine.proto
protoc --grpc_out=. --plugin=protoc-gen-grpc=`which grpc_cpp_plugin` francine.proto
g++ -std=c++11 -I/usr/local/include -pthread -c -o francine.pb.o francine.pb.cc
g++ -std=c++11 -I/usr/local/include -pthread -c -o francine.grpc.pb.o francine.grpc.pb.cc
g++ -std=c++11 -I/usr/local/include -pthread -c -o ao.o ao.cc
g++ -std=c++11 -I/usr/local/include -pthread -c -o main.o main.cc
g++ -std=c++11 -I/usr/local/include -pthread -c -o test.o test.cc
g++ -std=c++11 -I/usr/local/include -pthread -c -o lodepng.o lodepng.cc
g++ -std=c++11 -o francine -L/usr/local/lib -lgrpc++_unsecure -lgrpc -lgpr -lprotobuf -lpthread -ldl \
	ao.o main.o francine.pb.o francine.grpc.pb.o lodepng.o
g++ -std=c++11 -o test -L/usr/local/lib -lgrpc++_unsecure -lgrpc -lgpr -lprotobuf -lpthread -ldl \
	test.o francine.pb.o francine.grpc.pb.o



