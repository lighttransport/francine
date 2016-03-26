#include "worker.h"

#include <fstream>
#include <gflags/gflags.h>
#include <glog/logging.h>
#include <sstream>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

#include "ao.h"

using francine::FrancineWorker;
using francine::ImageType;
using francine::Renderer;
using francine::RunRequest;
using francine::RunResponse;
using francine::ComposeRequest;
using francine::ComposeResponse;
using francine::TransferRequest;
using francine::TransferResponse;
using francine::PutRequest;
using francine::PutResponse;
using francine::GetRequest;
using francine::GetResponse;
using francine::DeleteRequest;
using francine::DeleteResponse;
using grpc::CreateChannel;
using grpc::ClientContext;
using grpc::ClientReader;
using grpc::InsecureChannelCredentials;
using grpc::Status;
using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerReader;
using grpc::ServerReaderWriter;
using grpc::ServerWriter;

DEFINE_string(worker_address, "0.0.0.0:50052", "worker address to bind");

Status FrancineWorkerServiceImpl::Run(
    ServerContext* context,
    ServerReaderWriter<RunResponse, RunRequest>* stream) {
  LOG(INFO) << "rendering started";

  RunRequest request;
  // TODO(peryaudo): Accept streaming requests if the renderer supports
  if (!stream->Read(&request)) {
    return Status(grpc::INVALID_ARGUMENT, "");
  }

  if (request.renderer() == Renderer::AOBENCH) {
    RunResponse response;
    std::string result_id;
    if (file_manager_.Put(AoBench(), &result_id)) {
      LOG(INFO) << "failed to obtain aobench rendering result";
      return Status(grpc::DATA_LOSS, "");
    }
    response.set_id(result_id);
    response.set_image_type(ImageType::PNG);
    stream->Write(response);
  } else if (request.renderer() == Renderer::PBRT) {
    std::vector<std::pair<std::string, std::string>> files;
    for (auto&& file : request.files()) {
      files.emplace_back(file.id(), file.alias());
    }
    std::string tmpdir;
    if (file_manager_.CreateTmpDir(files, &tmpdir)) {
      LOG(INFO) << "failed to create temporary directory";
      return Status(grpc::DATA_LOSS, "");
    }

    chdir(tmpdir.c_str());

    system("/home/peryaudo/pbrt-v2/src/bin/pbrt buddha.pbrt");

    std::string result_id;
    if (file_manager_.Retain(tmpdir, "buddha.exr", &result_id)) {
      LOG(INFO) << "failed to obtain PBRT rendering result";
      file_manager_.RemoveTmpDir(tmpdir);
      return Status(grpc::DATA_LOSS, "");
    }

    RunResponse response;
    response.set_id(result_id);
    response.set_image_type(ImageType::EXR);
    stream->Write(response);

    file_manager_.RemoveTmpDir(tmpdir);

    LOG(INFO) << "rendering finished";
    return grpc::Status::OK;
  } else {
    LOG(ERROR) << "the renderer type is not implemented";
    return Status(grpc::UNIMPLEMENTED, "");
  }

  LOG(INFO) << "rendering finished";
  return grpc::Status::OK;
}

Status FrancineWorkerServiceImpl::Compose(
    ServerContext* context,
    const ComposeRequest* request, ComposeResponse* response) {
  // TODO(peryaudo): Implement.
  return Status(grpc::UNIMPLEMENTED, "");
}

Status FrancineWorkerServiceImpl::Transfer(
    ServerContext* context,
    const TransferRequest* request,
    TransferResponse* response) {
  LOG(INFO) << "transfer requested";

  std::unique_ptr<FrancineWorker::Stub> stub(
      FrancineWorker::NewStub(
        CreateChannel(request->src_address(), InsecureChannelCredentials())));

  GetRequest get_request;
  get_request.set_id(request->id());
  auto client_context = ClientContext::FromServerContext(*context);
  std::shared_ptr<ClientReader<GetResponse>> reader(
    stub->Get(client_context.get(), get_request));

  std::string content;
  GetResponse get_response;
  while (reader->Read(&get_response)) {
    content += get_response.content();
  }

  auto status = reader->Finish();
  if (!status.ok()) {
    LOG(INFO) << "transfer failed";
    return status;
  }
  
  std::string new_id;
  if (file_manager_.Put(content, &new_id) || new_id != request->id()) {
    return Status(grpc::DATA_LOSS, "");
  }

  LOG(INFO) << "transfer finished";

  return Status::OK;
}

Status FrancineWorkerServiceImpl::Put(
    ServerContext* context,
    ServerReader<PutRequest>* reader, PutResponse* response) {

  LOG(INFO) << "put requested";

  PutRequest request;
  std::string content;
  while (reader->Read(&request)) {
    content += request.content();
  }

  LOG(INFO) << "put content size: " << content.size();

  std::string content_id;
  file_manager_.Put(content, &content_id);
  response->set_id(content_id);

  LOG(INFO) << "put finished";
  return Status::OK;
}

Status FrancineWorkerServiceImpl::Get(
    ServerContext* context,
    const GetRequest* request, ServerWriter<GetResponse>* writer) {
  // TODO(peryaudo): Progressively Write()
  LOG(INFO) << "get requested";

  std::string content;
  if (file_manager_.Get(request->id(), &content)) {
    LOG(ERROR) << "get failed";
    return Status(grpc::NOT_FOUND, "");
  }

  GetResponse response;
  response.set_content(content);
  writer->Write(response);
  LOG(INFO) << "get finished";
  return Status::OK;
}

Status FrancineWorkerServiceImpl::Delete(
    ServerContext* context,
    const DeleteRequest* request, DeleteResponse* response) {

  LOG(INFO) << "delete requested";

  if (file_manager_.Delete(request->id())) {
    LOG(ERROR) << "no such file " << request->id() << " exists; ignore";
  }

  return Status::OK;
}

void RunWorker() {
  FrancineWorkerServiceImpl service;
  ServerBuilder builder;

  builder.AddListeningPort(
      FLAGS_worker_address, grpc::InsecureServerCredentials());
  builder.RegisterService(&service);

  std::unique_ptr<Server> server(builder.BuildAndStart());

  LOG(INFO) << "Listen on " << FLAGS_worker_address;
  server->Wait();
}
