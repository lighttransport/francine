#include "worker.h"

#include <glog/logging.h>
#include <string>

#include "ao.h"
#include "picosha2.h"

using francine::ImageType;
using francine::Renderer;
using francine::RunRequest;
using francine::RunResponse;
using francine::GetRequest;
using francine::GetResponse;
using grpc::Status;
using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerReaderWriter;
using grpc::ServerWriter;

Status FrancineWorkerServiceImpl::Run(
    ServerContext* context,
    ServerReaderWriter<RunResponse, RunRequest>* stream) {
  LOG(INFO) << "rendering started";

  RunRequest request;
  if (!stream->Read(&request)) {
    return Status(grpc::INVALID_ARGUMENT, "");
  }
  if (request.renderer() != Renderer::AOBENCH) {
    return Status(grpc::UNIMPLEMENTED, "");
  }

  RunResponse response;
  response.set_id(AddInmemoryFile(AoBench()));
  response.set_image_type(ImageType::PNG);
  stream->Write(response);

  LOG(INFO) << "rendering finished";
  return grpc::Status::OK;
}

Status FrancineWorkerServiceImpl::Get(
    ServerContext* context,
    const GetRequest* request, ServerWriter<GetResponse>* writer) {
  LOG(INFO) << "file requested";

  if (!inmemory_files_.count(request->id())) {
    return Status(grpc::NOT_FOUND, "");
  }

  GetResponse response;
  response.set_content(inmemory_files_[request->id()]);
  writer->Write(response);

  LOG(INFO) << "file transfered";
  return Status::OK;
}

std::string FrancineWorkerServiceImpl::AddInmemoryFile(
    const std::string& content) {
  std::string hash;
  picosha2::hash256_hex_string(content, hash);
  inmemory_files_[hash] = content;
  return hash;
}

void RunWorker() {
  const std::string server_address = "0.0.0.0:50052";

  FrancineWorkerServiceImpl service;
  ServerBuilder builder;

  builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());
  builder.RegisterService(&service);

  std::unique_ptr<Server> server(builder.BuildAndStart());
  server->Wait();
}
