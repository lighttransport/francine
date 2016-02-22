#ifndef FRANCINE_MASTER_H_
#define FRANCINE_MASTER_H_

#include <grpc++/grpc++.h>
#include <memory>
#include <set>
#include <vector>

#include "francine.grpc.pb.h"

struct WorkerInfo {
  std::string address;
  std::shared_ptr<grpc::Channel> channel;
  std::shared_ptr<francine::FrancineWorker::Stub> stub;
  std::set<std::string> files;

  WorkerInfo(const std::string& address)
      : address(address)
      , channel(CreateChannel(address, grpc::InsecureChannelCredentials()))
      , stub(francine::FrancineWorker::NewStub(channel)) { }
};

class FrancineServiceImpl final : public francine::Francine::Service {
 public:
  FrancineServiceImpl();

  grpc::Status Render(grpc::ServerContext* context,
                      const francine::RenderRequest* request,
                      francine::RenderResponse* response) override;

 private:
  std::vector<WorkerInfo> workers_;
  int worker_idx_;
};

void RunMaster();

#endif
