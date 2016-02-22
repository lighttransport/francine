#ifndef FRANCINE_WORKER_H_
#define FRANCINE_WORKER_H_

#include <grpc++/grpc++.h>

#include "francine.grpc.pb.h"

class FrancineWorkerServiceImpl final
    : public francine::FrancineWorker::Service {
 public:
  grpc::Status Run(grpc::ServerContext* context,
                   grpc::ServerReaderWriter<francine::RunResponse,
                                            francine::RunRequest>*
                   stream) override;

  grpc::Status Get(grpc::ServerContext* context,
                   const francine::GetRequest* request,

                   grpc::ServerWriter<francine::GetResponse>* writer) override; private:
  std::string AddInmemoryFile(const std::string& content);

  std::map<std::string, std::string> inmemory_files_;
};

void RunWorker();

#endif
