#ifndef FRANCINE_NODE_MANAGER_H_
#define FRANCINE_NODE_MANAGER_H_

#include <grpc++/grpc++.h>
#include <unordered_map>
#include <vector>

#include "francine.grpc.pb.h"

class NodeManager {
 public:
  int AddWorker(const std::string& address);
  void RemoveWorker(int worker_id);

  const std::string& GetWorkerAddress(int worker_id);
  std::shared_ptr<francine::FrancineWorker::Stub> GetWorkerStub(int worker_id);

  // Add workers from comma separated address strings.
  void AddWorkersFromString(const std::string& addresses);

  std::vector<int> worker_ids();

 private:
  struct WorkerInfo {
    std::string address;
    std::shared_ptr<grpc::Channel> channel;
    std::shared_ptr<francine::FrancineWorker::Stub> stub;

    WorkerInfo(const std::string& address)
        : address(address)
        , channel(CreateChannel(address, grpc::InsecureChannelCredentials()))
        , stub(francine::FrancineWorker::NewStub(channel)) { }
  };

  using WorkerId = int;
  std::unordered_map<WorkerId, WorkerInfo> workers_;
  int worker_cnt_;
};

#endif
