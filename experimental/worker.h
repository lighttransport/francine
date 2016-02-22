#ifndef FRANCINE_WORKER_H_
#define FRANCINE_WORKER_H_

#include <grpc++/grpc++.h>
#include <mutex>

#include "francine.grpc.pb.h"

class FrancineWorkerServiceImpl final
    : public francine::FrancineWorker::Service {
 public:
  virtual grpc::Status Run(
      grpc::ServerContext* context,
      grpc::ServerReaderWriter<francine::RunResponse, francine::RunRequest>*
      stream) override;

  virtual grpc::Status Compose(
      grpc::ServerContext* context,
      const francine::ComposeRequest* request,
      francine::ComposeResponse* response) override;

  virtual grpc::Status Transfer(
      grpc::ServerContext* context,
      const francine::TransferRequest* request,
      francine::TransferResponse* response) override;

  virtual grpc::Status Put(
      grpc::ServerContext* context,
      grpc::ServerReader<francine::PutRequest>* reader,
      francine::PutResponse* response) override;

  virtual grpc::Status Get(
      grpc::ServerContext* context,
      const francine::GetRequest* request,
      grpc::ServerWriter<francine::GetResponse>* writer) override;

  virtual grpc::Status Delete(
      grpc::ServerContext* context,
      const francine::DeleteRequest* request,
      francine::DeleteResponse* response) override;

 private:
  std::string AddInmemoryFile(const std::string& content);

  std::map<std::string, std::string> inmemory_files_;
  std::mutex inmemory_files_mutex_;
  std::atomic<int> tmp_cnt_;
};

void RunWorker();

#endif
