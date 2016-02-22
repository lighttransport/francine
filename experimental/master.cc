#include "master.h"

#include <glog/logging.h>
#include <string>

using francine::Francine;
using francine::FrancineWorker;
using francine::Renderer;
using francine::RenderRequest;
using francine::RenderResponse;
using francine::UploadDirectRequest;
using francine::UploadResponse;
using francine::RunRequest;
using francine::RunResponse;
using francine::PutRequest;
using francine::PutResponse;
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
using grpc::ServerReader;
using grpc::ServerReaderWriter;
using grpc::ServerWriter;

DEFINE_string(master_address, "0.0.0.0:50051", "master address to bind");
DEFINE_string(workers_list, "127.0.0.1:50052",
    "list of worker addresses (comma separated)");

FrancineServiceImpl::FrancineServiceImpl()
    : Francine::Service()
    , worker_idx_(0) {
  std::string address;
  for (int i = 0; i < FLAGS_workers_list.size(); ++i) {
    if (FLAGS_workers_list[i] != ',') {
      address += FLAGS_workers_list[i];
    }

    if (FLAGS_workers_list[i] == ',' ||
        i == FLAGS_workers_list.size() - 1) {
      LOG(INFO) << "worker added: " << address;
      workers_.emplace_back(address);
      address.clear();
    }
  }
}

Status FrancineServiceImpl::Render(
    ServerContext* context,
    const RenderRequest* request, RenderResponse* response) {
  if (worker_idx_ >= workers_.size()) {
    LOG(ERROR) << "no worker available!";
    return Status(grpc::RESOURCE_EXHAUSTED, "");
  }

  LOG(INFO) << "work assigned to worker " << workers_[worker_idx_].address;

  // TODO(peryaudo): Return error if any of request->files is expired

  // Pick worker by round robin.
  // TODO(peryaudo): Pick worker in a way that optimizes cache efficiency
  auto stub = workers_[worker_idx_].stub;
  worker_idx_ = (worker_idx_ + 1) % workers_.size();

  // TODO(peryaudo): Transfer files that are given in request->files

  auto client_context = ClientContext::FromServerContext(*context);
  std::shared_ptr<ClientReaderWriter<RunRequest, RunResponse>> stream(
      stub->Run(client_context.get()));

  RunRequest run_request;
  run_request.set_renderer(Renderer::AOBENCH);
  stream->Write(run_request);
  stream->WritesDone();

  RunResponse run_response;
  // TODO(peryaudo): Accept streaming requests if the renderer supports
  stream->Read(&run_response);
  auto status = stream->Finish();
  if (!status.ok()) {
    LOG(ERROR) << "render failed";
    return status;
  }

  GetRequest get_request;
  get_request.set_id(run_response.id());
  client_context = ClientContext::FromServerContext(*context);
  std::shared_ptr<ClientReader<GetResponse>> reader(
      stub->Get(client_context.get(), get_request));
  GetResponse get_response;
  reader->Read(&get_response);
  status = reader->Finish();
  if (!status.ok()) {
    LOG(ERROR) << "get failed";
    return status;
  }

  response->set_image(get_response.content());
  response->set_image_type(run_response.image_type());

  return Status::OK;
}

Status FrancineServiceImpl::RenderStream(
    ServerContext* context,
    ServerReaderWriter<RenderResponse, RenderRequest>* stream) {
  // TODO(peryaudo): Implement.
  return Status(grpc::UNIMPLEMENTED, "");
}


Status FrancineServiceImpl::UploadDirect(
    ServerContext* context,
    const UploadDirectRequest* request, UploadResponse* response) {
  if (worker_idx_ >= workers_.size()) {
    LOG(ERROR) << "no worker available!";
    return Status(grpc::RESOURCE_EXHAUSTED, "");
  }

  // Pick worker by round robin.
  // TODO(peryaudo): Pick worker in a way that optimizes cache efficiency
  // Keeping worker storage usage flat? It depends on optimization strategy.
  auto&& worker = workers_[worker_idx_];
  worker_idx_ = (worker_idx_ + 1) % workers_.size();

  LOG(INFO) << "upload assigned to worker " << worker.address;
  auto stub = worker.stub;

  auto client_context = ClientContext::FromServerContext(*context);
  PutResponse put_response;
  std::unique_ptr<ClientWriter<PutRequest>> writer(
      stub->Put(client_context.get(), &put_response));

  PutRequest put_request;
  put_request.set_content(request->content());
  writer->Write(put_request);
  writer->WritesDone();
  auto status = writer->Finish();
  if (!status.ok()) {
    LOG(ERROR) << "put failed";
    return status;
  }

  // TODO(peryaudo): set expiration
  response->set_id(put_response.id());

  worker.files.insert(put_response.id());

  LOG(INFO) << "UploadDirect finished";

  return Status::OK;
}

Status FrancineServiceImpl::UploadDirectStream(
    ServerContext* context,
    ServerReader<UploadDirectRequest>* reader, UploadResponse* response) {
  // TODO(peryaudo): Implement.
  return Status(grpc::UNIMPLEMENTED, "");
}

void RunMaster() {
  FrancineServiceImpl service;
  ServerBuilder builder;

  builder.AddListeningPort(
      FLAGS_master_address, grpc::InsecureServerCredentials());
  builder.RegisterService(&service);

  std::unique_ptr<Server> server(builder.BuildAndStart());

  LOG(INFO) << "Listen on " << FLAGS_master_address;
  server->Wait();
}
