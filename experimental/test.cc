#include <glog/logging.h>
#include <grpc++/grpc++.h>
#include <iostream>

#include "francine.grpc.pb.h"

using francine::Francine;
using francine::Renderer;
using francine::RenderRequest;
using francine::RenderResponse;
using francine::UploadDirectRequest;
using francine::UploadResponse;
using grpc::CreateChannel;
using grpc::ClientContext;
using grpc::InsecureChannelCredentials;

int main(int argc, char* argv[]) {
  gflags::ParseCommandLineFlags(&argc, &argv, true);
  google::InitGoogleLogging(argv[0]);

  FLAGS_logtostderr = 1;

  std::unique_ptr<Francine::Stub> stub(
      Francine::NewStub(
        CreateChannel("localhost:50051", InsecureChannelCredentials())));

  auto context = std::make_shared<ClientContext>();
  UploadDirectRequest upload_request;
  upload_request.set_content("Hello world!");
  UploadResponse upload_response;
  auto status = stub->UploadDirect(
      context.get(), upload_request, &upload_response);
  if (status.ok()) {
    LOG(INFO) << "UploadDirect succeeded. file id: " << upload_response.id();
  } else {
    LOG(ERROR) << "UploadDirect failed";
    return 1;
  }

  context = std::make_shared<ClientContext>();
  RenderRequest request;
  request.set_renderer(Renderer::PBRT);
  request.add_files()->set_id(upload_response.id());
  RenderResponse response;
  status = stub->Render(context.get(), request, &response);

  if (status.ok()) {
    LOG(INFO) << "Render succeeded";
  } else {
    LOG(ERROR) << "Render failed";
    return 1;
  }

  std::cout<<response.image()<<std::endl;

  return 0;
}
