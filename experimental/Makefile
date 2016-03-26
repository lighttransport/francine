CXX = g++
CXXFLAGS = -std=c++11 -I/usr/local/include -pthread
LDFLAGS = -L/usr/local/lib -lgrpc++_unsecure -lgrpc -lgpr -lprotobuf -lpthread -ldl -lgflags -lglog
PROTOC = protoc
GRPC_CPP_PLUGIN = grpc_cpp_plugin
GRPC_CPP_PLUGIN_PATH ?= `which $(GRPC_CPP_PLUGIN)`

all: francine test

francine: francine.pb.o francine.grpc.pb.o ao.o main.o lodepng.o master.o worker.o worker_file_manager.o master_file_manager.o
	$(CXX) $^ $(LDFLAGS) -o $@

test: francine.pb.o francine.grpc.pb.o test.o
	$(CXX) $^ $(LDFLAGS) -o $@

%.grpc.pb.cc: %.proto
	$(PROTOC) --grpc_out=. --plugin=protoc-gen-grpc=$(GRPC_CPP_PLUGIN_PATH) $<

%.pb.cc: %.proto
	$(PROTOC) --cpp_out=. $<

clean:
	rm -f *.o *.pb.cc *.pb.h francine test
