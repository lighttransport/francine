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
using francine::TransferRequest;
using francine::TransferResponse;
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
    , node_manager_()
    , master_file_manager_(node_manager_) {
  node_manager_.AddWorkersFromString(FLAGS_workers_list);
}

Status FrancineServiceImpl::Render(
    ServerContext* context,
    const RenderRequest* request, RenderResponse* response) {
  // TODO(peryaudo): Pick worker in a way that optimizes cache efficiency.
  // Also, it should be done in policy.
  const int worker_id = master_file_manager_.GetEmptyWorker();

  if (worker_id < 0) {
    LOG(ERROR) << "no worker available!";
    return Status(grpc::RESOURCE_EXHAUSTED, "");
  }

  const std::string& worker_address = node_manager_.GetWorkerAddress(worker_id);
  auto stub = node_manager_.GetWorkerStub(worker_id);
  LOG(INFO) <<
    "work assigned to worker " << worker_address;

  for (auto&& file : request->files()) {
    if (!master_file_manager_.IsFileAlive(file.id())) {
      LOG(ERROR) << "file " << file.id() << " is not available!";
      return Status(grpc::NOT_FOUND, "");
    }
  }

  std::vector<std::string> file_ids;
  for (auto&& file : request->files()) {
    file_ids.emplace_back(file.id());
  }

  // TODO(peryaudo): Extra locks are needed

  // Transfer required files that are not on the selected worker.
  std::vector<std::string> missing_file_ids;
  master_file_manager_.ListMissingFiles(worker_id, file_ids, &missing_file_ids);
  LOG(INFO) << missing_file_ids.size() << " of "<<
    request->files().size() << " files have to be transferred";

  for (auto&& file_id : missing_file_ids) {
    TransferRequest transfer_request;
    transfer_request.set_id(file_id);

    // Find a worker with the file.
    auto&& src_worker_id = master_file_manager_.GetWorkerWithFile(file_id);
    if (src_worker_id < 0) {
      LOG(ERROR) << "worker with file " << file_id << " does not exist";
      return Status(grpc::DATA_LOSS, "");
    }
    transfer_request.set_src_address(node_manager_.GetWorkerAddress(src_worker_id));

    LOG(INFO) << "requesting transfer of " << file_id
      << " to " << worker_address << " from " << transfer_request.src_address();

    TransferResponse transfer_response;
    auto client_context = ClientContext::FromServerContext(*context);
    auto status = stub->Transfer(
        client_context.get(), transfer_request, &transfer_response);
    if (!status.ok()) {
      master_file_manager_.UnlockFiles(file_ids, worker_id);
      return status;
    }

    master_file_manager_.NotifyFilePut(file_id, transfer_response.file_size(),
                                       worker_id, /* lock = */ true);
  }

  master_file_manager_.LockFiles(file_ids, worker_id);

  auto client_context = ClientContext::FromServerContext(*context);
  std::shared_ptr<ClientReaderWriter<RunRequest, RunResponse>> stream(
      stub->Run(client_context.get()));

  RunRequest run_request;
  run_request.set_renderer(request->renderer());
  stream->Write(run_request);
  stream->WritesDone();

  RunResponse run_response;
  // TODO(peryaudo): Accept streaming requests if the renderer supports
  stream->Read(&run_response);
  auto status = stream->Finish();
  if (!status.ok()) {
    LOG(ERROR) << "render failed";
    master_file_manager_.UnlockFiles(file_ids, worker_id);
    return status;
  }

  // Register the result image file to file manager
  master_file_manager_.NotifyFilePut(
      run_response.id(), run_response.file_size(),
      worker_id, /* lock = */ false);

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
    master_file_manager_.UnlockFiles(file_ids, worker_id);
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
  // TODO(peryaudo): Pick worker in a way that optimizes cache efficiency
  // Keeping worker storage usage flat? It depends on optimization strategy.
  const int worker_id = master_file_manager_.GetEmptyWorker();
  if (worker_id < 0) {
    LOG(ERROR) << "no worker available!";
    return Status(grpc::RESOURCE_EXHAUSTED, "");
  }

  LOG(INFO) <<
    "upload assigned to worker " << node_manager_.GetWorkerAddress(worker_id);
  auto stub = node_manager_.GetWorkerStub(worker_id);

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

  master_file_manager_.NotifyFilePut(
      put_response.id(), put_response.file_size(), worker_id,
      /* lock = */ false);

  response->set_id(put_response.id());

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
