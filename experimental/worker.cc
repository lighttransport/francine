#include "worker.h"

#include <gflags/gflags.h>
#include <glog/logging.h>
#include <sstream>
#include <fstream>
#include <string>
#include <unistd.h>

#include "ao.h"
#include "picosha2.h"

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
DEFINE_string(tmpdir, "/tmp", "temporary directory to store files");
DEFINE_int64(inmemory_threshold, 0, "temporary directory to store files");

Status FrancineWorkerServiceImpl::Run(
    ServerContext* context,
    ServerReaderWriter<RunResponse, RunRequest>* stream) {
  LOG(INFO) << "rendering started";

  RunRequest request;
  // TODO(peryaudo): Accept streaming requests if the renderer supports
  if (!stream->Read(&request)) {
    return Status(grpc::INVALID_ARGUMENT, "");
  }

  // TODO(peryaudo): Check if all these files are on the worker
  // TODO(peryaudo): Prepare symbolic links for renderer
  // TODO(peryaudo): splill out in memory file to disk if required

  if (request.renderer() == Renderer::AOBENCH) {
    RunResponse response;
    response.set_id(AddInmemoryFile(AoBench()));
    response.set_image_type(ImageType::PNG);
    stream->Write(response);

    LOG(INFO) << "rendering finished";
    return grpc::Status::OK;
  } else if (request.renderer() == Renderer::PBRT) {
    chdir("/home/peryaudo/pbrt-scenes");
    system("/home/peryaudo/pbrt-v2/src/bin/pbrt buddha.pbrt");
    std::ifstream ifs("buddha.exr");
    std::string result((std::istreambuf_iterator<char>(ifs)),
                       std::istreambuf_iterator<char>());
    RunResponse response;
    response.set_id(AddInmemoryFile(result));
    response.set_image_type(ImageType::EXR);
    stream->Write(response);
    LOG(INFO) << "rendering finished";
    return grpc::Status::OK;
  } else {
    LOG(ERROR) << "the renderer type is not implemented";
    return Status(grpc::UNIMPLEMENTED, "");
  }
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
  // TODO(peryaudo): Support on disk files
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
  
  auto new_id = AddInmemoryFile(content);
  if (new_id != request->id()) {
    return Status(grpc::DATA_LOSS, "");
  }

  LOG(INFO) << "transfer finished";

  return Status::OK;
}

Status FrancineWorkerServiceImpl::Put(
    ServerContext* context,
    ServerReader<PutRequest>* reader, PutResponse* response) {
  // TODO(peryaudo): Support on disk files

  LOG(INFO) << "put requested";

  PutRequest request;
  std::string content;
  while (reader->Read(&request)) {
    content += request.content();
  }

  LOG(INFO) << "put content size: " << content.size();

  if (content.size() > FLAGS_inmemory_threshold) {
    std::string hash;
    picosha2::hash256_hex_string(content, hash);
    std::ofstream ofs(FLAGS_tmpdir + "/" + hash);
    ofs << content;
    response->set_id(hash);
  } else {
    response->set_id(AddInmemoryFile(content));
  }

  LOG(INFO) << "put finished";
  return Status::OK;
}

Status FrancineWorkerServiceImpl::Get(
    ServerContext* context,
    const GetRequest* request, ServerWriter<GetResponse>* writer) {
  // TODO(peryaudo): Support on disk files
 
  std::lock_guard<std::mutex> lock(inmemory_files_mutex_);
  LOG(INFO) << "get requested";

  GetResponse response;
  if (inmemory_files_.count(request->id())) {
    response.set_content(inmemory_files_[request->id()]);
    writer->Write(response);
    LOG(INFO) << "get finished";
    return Status::OK;
  }

  std::ifstream ifs(FLAGS_tmpdir + "/" + request->id());
  if (ifs.good()) {
    std::vector<char> buffer(1024 * 64);
    while (!ifs.eof()) {
      ifs.read(buffer.data(), buffer.size());
      response.set_content(
          std::string(buffer.begin(), buffer.begin() + ifs.gcount()));
      writer->Write(response);
    }
    return Status::OK;
  }

  LOG(ERROR) << "get failed";
  return Status(grpc::NOT_FOUND, "");
}

Status FrancineWorkerServiceImpl::Delete(
    ServerContext* context,
    const DeleteRequest* request, DeleteResponse* response) {
  // TODO(peryaudo): Support on disk files

  LOG(INFO) << "delete requested";

  std::lock_guard<std::mutex> lock(inmemory_files_mutex_);
  if (inmemory_files_.count(request->id())) {
    inmemory_files_.erase(request->id());
    LOG(INFO) << "inmemory file deleted";
  }

  const std::string filename = FLAGS_tmpdir + '/' + request->id();

  if (!remove(filename.c_str())) {
    LOG(INFO) << "on disk file deleted";
  }

  LOG(ERROR) << "no such file " << request->id() << " exists; ignore";
  return Status::OK;
}

std::string FrancineWorkerServiceImpl::AddInmemoryFile(
    const std::string& content) {
  std::string hash;

  picosha2::hash256_hex_string(content, hash);

  std::lock_guard<std::mutex> lock(inmemory_files_mutex_);
  inmemory_files_[hash] = content;

  return hash;
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
