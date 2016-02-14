#include <iostream>

#include <grpc++/grpc++.h>

#include "francine.grpc.pb.h"

int main(int argc, char* argv[]) {
  std::unique_ptr<francine::Francine::Stub> stub(
      francine::Francine::NewStub(
        grpc::CreateChannel("localhost:50051", grpc::InsecureChannelCredentials())));

  grpc::ClientContext context;
  francine::RenderRequest request;
  francine::RenderResponse response;
  auto status = stub->Render(&context, request, &response);

  if (status.ok()) {
    std::cerr<<"RPC succeeded"<<std::endl;
  } else {
    std::cerr<<"RPC failed"<<std::endl;
  }
  std::cout<<response.image()<<std::endl;

  return 0;
}
