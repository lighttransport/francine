#include "master.h"

#include <glog/logging.h>
#include <string>

using francine::Francine;
using francine::FrancineWorker;
using francine::Renderer;
using francine::RenderRequest;
using francine::RenderResponse;
using francine::RunRequest;
using francine::RunResponse;
using francine::GetRequest;
using francine::GetResponse;
using grpc::CreateChannel;
using grpc::ClientContext;
using grpc::ClientReader;
using grpc::ClientReaderWriter;
using grpc::ClientWriter;
using grpc::InsecureChannelCredentials;
using grpc::Status;
using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerReaderWriter;
using grpc::ServerWriter;

FrancineServiceImpl::FrancineServiceImpl()
    : Francine::Service()
    , stub_(FrancineWorker::NewStub(
          CreateChannel("localhost:50052", InsecureChannelCredentials()))) {
}

Status FrancineServiceImpl::Render(
    ServerContext* context,
    const RenderRequest* request, RenderResponse* response) {
  ClientContext client_context;
  std::shared_ptr<ClientReaderWriter<RunRequest, RunResponse>> stream(
      stub_->Run(&client_context));

  RunRequest run_request;
  run_request.set_renderer(Renderer::AOBENCH);
  stream->Write(run_request);
  stream->WritesDone();

  RunResponse run_response;
  stream->Read(&run_response);
  auto status = stream->Finish();
  if (!status.ok()) {
    return status;
  }

  GetRequest get_request;
  get_request.set_id(run_response.id());
  ClientContext client_context2;
  std::shared_ptr<ClientReader<GetResponse>> reader(
      stub_->Get(&client_context2, get_request));
  GetResponse get_response;
  reader->Read(&get_response);
  status = reader->Finish();
  if (!status.ok()) {
    return status;
  }

  response->set_image(get_response.content());
  response->set_image_type(run_response.image_type());

  return grpc::Status::OK;
}

void RunMaster() {
  const std::string server_address = "0.0.0.0:50051";

  FrancineServiceImpl service;
  ServerBuilder builder;

  builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());
  builder.RegisterService(&service);

  std::unique_ptr<Server> server(builder.BuildAndStart());
  server->Wait();
}
